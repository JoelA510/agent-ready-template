"""Offline controls for the output of docker compose config; run in the frozen Nomos venv."""
import sys
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from operator_cli import APPS, EXTERNAL, LOCK, SERVICES, check_render
from receipt import Rejected


class EffectiveDeployment(unittest.TestCase):
    def setUp(self):
        self.images = {name: "sha256:" + "a" * 64 for name in APPS}
        self.config = {"services": {}}
        for name in SERVICES:
            service = {"platform": "linux/amd64"}
            if name in EXTERNAL:
                service["image"] = EXTERNAL[name]
            else:
                service.update(image=f"agent-nomos/{name}:{self.images[name][7:]}", pull_policy="never")
            if name in LOCK["loopback"]:
                host, container = LOCK["loopback"][name].split(":")
                service["ports"] = [dict(host_ip="127.0.0.1", published=host, target=int(container))]
            self.config["services"][name] = service
        self.config["services"]["council"]["environment"] = dict(COUNCIL_OPA_ENABLED="true",
            COUNCIL_OPA_FAIL_CLOSED="true", COUNCIL_ALLOW_UNCERTIFIED_EVIDENCE="false", NOMOS_SIGNER_PROVIDER="vault")

    def test_qualified_shape(self):
        check_render(self.config, self.images)

    def test_refuses_drift(self):
        for name, changed in [
            ("monitor", {"ports": [dict(host_ip="0.0.0.0", target=9901, published="9901")]}),
            ("opa", {"image": "openpolicyagent/opa:latest"}),
            ("vault", {"privileged": True}),
            ("redis", {"network_mode": "host"}),
            ("openshell", {"volumes": [dict(type="bind", source="/var/run/docker.sock")]}),
            ("council", {"environment": {}}),
            ("executor-openshell", {"build": {"context": "/unexpected"}}),
            ("demo", {"image": "arbitrary:latest"}),
        ]:
            with self.subTest(service=name), self.assertRaises(Rejected):
                bad = deepcopy(self.config)
                bad["services"][name].update(changed)
                check_render(bad, self.images)
        with self.assertRaises(Rejected):
            check_render({"services": {}}, self.images)


if __name__ == "__main__":
    unittest.main()
