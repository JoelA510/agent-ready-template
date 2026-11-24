"""Operate only the isolated, digest-locked local Nomos project."""
import argparse
import fcntl
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from receipt import Rejected, private_file, require, sha, state_path

LOCK = json.loads((HERE / "deployment.lock.json").read_text())
SOURCE = HERE.parent / "upstream"
DEPLOY = SOURCE / "deploy"
REDIS = ["redis", "redis-1", "redis-2", "redis-sentinel-1", "redis-sentinel-2", "redis-sentinel-3"]
EXTERNAL = {**LOCK["infrastructure"], **dict.fromkeys(REDIS, LOCK["infrastructure"]["redis"])}
APPS = LOCK["dockerfiles"]
SERVICES = EXTERNAL.keys() | APPS.keys()
INPUTS = ["docker-compose.yml", "docker-compose.redis-sentinel.yml", "docker-compose.service.yml"]


def publish(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        try:
            tmp.write(content.encode())
            tmp.flush()
            os.fsync(tmp.fileno())
            os.replace(tmp.name, path)
        finally:
            Path(tmp.name).unlink(missing_ok=True)


def run(argv, env, timeout=120):
    # Upstream compose-up prints signup passwords even on success. Keep all raw output private.
    p = subprocess.run(argv, env=env, cwd=SOURCE, capture_output=True, text=True, timeout=timeout)
    require(p.returncode == 0, f"{Path(argv[0]).name} failed ({p.returncode})")
    return p.stdout


def base_env(state):
    require(str(state).find(":") == -1 and str(HERE).find(":") == -1, "unsupported colon in Compose paths")
    return dict(PATH="/usr/local/bin:/usr/bin:/bin", HOME=str(HERE.parent / "home"), LANG="C.UTF-8",
                COMPOSE_PROJECT="agent-nomos-" + sha(os.fsencode(state))[:12], COMPOSE_REDIS_TOPOLOGY="sentinel",
                ENV_FILE=str(state / "service.env"), COMPOSE_PROFILES="executor-openshell",
                # Upstream translates the already-selected private provider into the council env file.
                COUNCIL_ALLOW_UNCERTIFIED_EVIDENCE="false", COUNCIL_OPA_ENABLED="true", COUNCIL_OPA_FAIL_CLOSED="true")


def overlay(state, images=None):
    rows = ["services:"]
    for name in sorted(SERVICES):
        rows.extend([f"  {name}:", "    platform: linux/amd64"])
        if name in EXTERNAL:
            rows.append("    image: " + EXTERNAL[name])
        elif images is not None:
            image = images[name]
            require(re.fullmatch(r"sha256:[a-f0-9]{64}", image), "invalid qualified service image")
            rows.extend(["    build: !reset null", "    pull_policy: never", f"    image: agent-nomos/{name}:{image[7:]}"])
        else:
            rows.extend(["    build:", "      dockerfile: " + json.dumps(str(state / ("locked-" + APPS[name])))])
        ports = LOCK["loopback"].get(name)
        rows.append("    ports: !override " + json.dumps(["127.0.0.1:" + ports] if ports else []))
    return "\n".join(rows) + "\n"


def check_render(config, images):
    services = config["services"]
    require(set(services) == SERVICES, "unexpected effective Nomos services or profiles")
    for name, service in services.items():
        require(service.get("platform") == LOCK["platform"] and not service.get("privileged")
                and service.get("network_mode") != "host", "unsafe effective platform or privilege")
        ports = service.get("ports", [])
        expected = LOCK["loopback"].get(name)
        require(len(ports) == int(expected is not None) and all(p.get("host_ip") == "127.0.0.1"
                and f'{p["published"]}:{p["target"]}' == expected for p in ports), "unexpected published port")
        for mount in service.get("volumes", []):
            if mount["type"] == "bind":
                require(Path(mount["source"]).resolve().is_relative_to(SOURCE.resolve())
                        and ".sock" not in mount["source"], "unexpected host bind")
        if name in EXTERNAL:
            require(service.get("image") == EXTERNAL[name] and not service.get("build"), "infrastructure lock mismatch")
        elif images is not None:
            require(service.get("image") == f"agent-nomos/{name}:{images[name][7:]}"
                    and not service.get("build") and service.get("pull_policy") == "never", "workload lock mismatch")
    council = services["council"]["environment"]
    require(all(council.get(k) == "true" for k in ["COUNCIL_OPA_ENABLED", "COUNCIL_OPA_FAIL_CLOSED"])
            and council.get("COUNCIL_ALLOW_UNCERTIFIED_EVIDENCE") == "false"
            and council.get("NOMOS_SIGNER_PROVIDER") == "vault", "council policy or signer mismatch")


def compose(env, extra):
    return ["docker", "compose", "-p", env["COMPOSE_PROJECT"], "--profile", "executor-openshell",
            "--env-file", env["ENV_FILE"], *[x for name in INPUTS for x in ["-f", str(DEPLOY / name)]],
            "-f", str(extra)]


def prepare(state, env, mode):
    # Only an image qualification builds. Application/runtime Dockerfiles are kept outside the checkout.
    for name in set(APPS.values()):
        original = (DEPLOY / name).read_text()
        edited, count = re.subn(r"(?m)^FROM python:3\.13-slim(?:@sha256:[a-f0-9]{64})?(?= |$)",
                                "FROM " + LOCK["python"], original)
        require(count == 1 and all(LOCK["python"] in line for line in edited.splitlines() if line.startswith("FROM ")),
                "unknown build stage")
        if name == "Dockerfile":
            require(edited.count("RUN pip install --no-cache-dir uv") == 1, "council build changed")
            edited = edited.replace("RUN pip install --no-cache-dir uv", "COPY --chmod=0755 .local-power-uv /usr/local/bin/uv")
        publish(state / ("locked-" + name), edited)
    for path, digest in LOCK["upstream"].items():
        require(sha((SOURCE / path).read_bytes()) == digest, "upstream deployment lock mismatch")
    image_file = state / "qualified-images.json"
    qualifier = sha((HERE / "deployment.lock.json").read_bytes() + (HERE / "operator_cli.py").read_bytes()
                    + run(["git", "rev-parse", "HEAD"], env).strip().encode())
    images = None
    if mode not in {"qualify-images", "render"}:
        record = json.loads(private_file(image_file))
        require(record["inputs_sha256"] == qualifier, "service image lock belongs to a different release")
        images = record["images"]
    if images is not None:
        require(set(images) == set(APPS), "incomplete qualified workload images")
    extra = state / ("build-overlay.yml" if images is None else "runtime-overlay.yml")
    publish(extra, overlay(state, images))
    env["COMPOSE_EXTRA_FILES"] = str(DEPLOY / INPUTS[-1]) + ":" + str(extra)
    cmd = compose(env, extra)
    if mode in {"qualify-images", "render"}:
        # Plain render/build must never see the provider or service credentials.
        sandbox = state / "render.env"
        publish(sandbox, "POSTGRES_PASSWORD=renderfixture\nPOSTGRES_PASSWORD_URLENCODED=renderfixture\n")
        env["ENV_FILE"] = str(sandbox)
        cmd = compose(env, extra)
    check_render(json.loads(run(cmd + ["config", "--format", "json"], env)), images)
    return cmd, images, qualifier


def check_image(tag, env):
    fields = run(["docker", "image", "inspect", "--format", "{{.Id}} {{.Os}}/{{.Architecture}}", tag], env).split()
    require(len(fields) == 2 and re.fullmatch(r"sha256:[0-9a-f]{64}", fields[0]) and fields[1] == LOCK["platform"],
            "unqualified workload platform")
    return fields[0]


def main(args):
    state = state_path()
    require(state.is_absolute() and state.resolve() == state and state.is_dir(), "invalid private state")
    env = base_env(state)
    # All upstream secret updates and pack-local image lock publications belong to one operator.
    with open(state / ".operator.lock", "a+b") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == "stop":
            # Recovery also works when credentials have expired or a new pin cannot be rendered.
            containers = run(["docker", "ps", "-q", "--no-trunc", "--filter",
                              "label=com.docker.compose.project=" + env["COMPOSE_PROJECT"]], env).split()
            require(all(re.fullmatch(r"[0-9a-f]{64}", cid) for cid in containers), "invalid project container ID")
            if containers:
                run(["docker", "stop", *containers], env, 300)
            return {"action": "stop", "project": env["COMPOSE_PROJECT"], "stopped": len(containers)}
        if args.action in {"up", "verify", "prove"}:
            require(args.allow_provider, "explicit --allow-provider required for a council request")
        if args.action == "up" and not (state / "service.env").exists():
            provider = private_file(state / "provider.env").decode().strip()
            require(re.fullmatch(r"NVIDIA_API_KEY=[A-Za-z0-9._+/=:-]+", provider), "expected an enrolled NVIDIA provider key")
            password = secrets.token_hex(32)
            publish(state / "service.env", provider + f"\nPOSTGRES_PASSWORD={password}\nPOSTGRES_PASSWORD_URLENCODED={password}\n")
        cmd, images, qualifier = prepare(state, env, args.action)
        if args.action == "qualify-images":
            # Qualification may contact package/image registries. It starts no container or model.
            require(not (state / "qualified-images.json").exists(), "existing qualification: retain it or archive it explicitly before rebuilding")
            run(cmd + ["build", *sorted(APPS)], env, 3600)
            images = {}
            for name in sorted(APPS):
                image = check_image(env["COMPOSE_PROJECT"] + "-" + name, env)
                run(["docker", "tag", image, f"agent-nomos/{name}:{image[7:]}"], env)
                images[name] = image
            publish(state / "qualified-images.json", json.dumps({"inputs_sha256": qualifier, "images": images}, sort_keys=True))
        elif args.action in {"up", "verify", "prove"}:
            for name, image in images.items():
                require(check_image(f"agent-nomos/{name}:{image[7:]}", env) == image, "qualified workload image drift")
            if args.action == "up":
                run(["bash", str(DEPLOY / "scripts/compose-up.sh"), "--yes", "--skip-build"], env, 1800)
            elif args.action == "verify":
                run(["bash", str(DEPLOY / "scripts/compose-verify.sh")], env, 600)
            for name, image in images.items():
                cid = run(cmd + ["ps", "-q", name], env).strip()
                require(cid and run(["docker", "inspect", "--format", "{{.Image}}", cid], env).strip() == image,
                        "running workload differs from qualified image")
            if args.action == "prove":
                import asyncio
                from live import prove
                return asyncio.run(prove(state))
        return {"action": args.action, "project": env["COMPOSE_PROJECT"], "services": len(SERVICES),
                "scope": "review/attestation only"}


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["render", "qualify-images", "up", "verify", "prove", "stop"])
    parser.add_argument("--allow-provider", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(main(args)))
    except Exception as exc:
        sys.exit(str(exc) if isinstance(exc, Rejected) else "Nomos operation failed; inspect private enrollment, image lock and service health")
