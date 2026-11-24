"""A fixed loopback proof. No caller-supplied command, URL, resource body or model prompt."""
import asyncio
import base64
import json
import os
import secrets
import tempfile
import time
from pathlib import Path

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from receipt import COMMAND, DESCRIPTION, DIRECTORY, checked_writ, private_file, receipt, require, trust_config

MCP = "http://127.0.0.1:9901/mcp"
EXECUTE = "http://127.0.0.1:9907/v1/writs/execute"


async def prove(state):
    trust = trust_config(json.loads(private_file(state / "trust.json")))
    service = {}
    for line in private_file(state / "service.env").decode().splitlines():
        key, _, value = line.partition("=")
        if key in {"MONITOR_MCP_PROXY_TOKEN", "NOMOS_AUTH_TOKEN"}:
            service[key] = value
    proxy, token = service["MONITOR_MCP_PROXY_TOKEN"], service["NOMOS_AUTH_TOKEN"]
    require(proxy and token, "missing private agent or monitor enrollment")
    # Each request is local; ambient proxy configuration must not receive bearer credentials.
    for name in list(os.environ):
        if name.lower() in {"http_proxy", "https_proxy", "all_proxy"}:
            os.environ.pop(name)
    async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
        for headers in [{}, {"Authorization": "Bearer " + secrets.token_hex(24)}]:
            response = await client.post(MCP, headers=headers, json={"jsonrpc": "2.0", "method": "tools/list", "id": 1})
            require(response.status_code in (401, 403), "monitor did not deny missing or incorrect bearer token")
        async with streamablehttp_client(MCP, headers={"Authorization": "Bearer " + proxy}) as (r, w, _):
            async with ClientSession(r, w) as session:
                await session.initialize()
                tools = await session.list_tools()
                require("council_authorize" in {t.name for t in tools.tools}, "missing council authorization tool")
                answer = await session.call_tool("council_authorize", arguments={
                    "auth_token": token, "agent_id": trust["agent"], "council_id": trust["council"],
                    "command": COMMAND, "working_directory": DIRECTORY, "description": DESCRIPTION,
                    "target_resource": trust["repository"], "target_environment": "development",
                    "justification": "Verify the enrolled local receipt.", "blast_radius": "Print fixed text only.",
                })
                require(not answer.isError, "council failed the fixed authorization")
                decision = json.loads(answer.content[0].text)
        require(decision["status"] == "approved" and decision["council_id"] == trust["council"], "council did not approve")
        raw = base64.b64decode(decision["writ"], validate=True)
        writ = checked_writ(raw, trust, decision["decision_id"], time.time())
        require(writ.writ_id == decision["writ_id"] and 1 < writ.expires_at - time.time() <= 600,
                "Writ identity or lifetime outside proof bounds")

        async def execute(encoded, agent):
            r = await client.post(EXECUTE, json={"writ": encoded}, headers={"X-Agent-ID": agent})
            require(r.status_code == 200, "executor did not return a structured execution result")
            return r

        async def denied(encoded, agent, stage):
            data = (await execute(encoded, agent)).json()
            require(data.get("success") is False and data.get("verification_stage") == stage,
                    "executor did not deny at the expected stage")

        bad = writ.model_copy(update={"signature": "00" * 64}).model_dump_json().encode()
        await denied(base64.b64encode(bad).decode(), trust["agent"], "signature")
        await denied(decision["writ"], trust["agent"] + "-other", "agent_binding")
        result = (await execute(decision["writ"], trust["agent"])).content
        links = receipt(raw, result, trust, decision["decision_id"])
        await denied(decision["writ"], trust["agent"], "nonce")
        await asyncio.sleep(max(0, writ.expires_at - time.time()) + 1)
        await denied(decision["writ"], trust["agent"], "temporal")
    archive = Path(tempfile.mkdtemp(prefix="proof-", dir=state))
    for name, contents in {"writ.json": raw, "result.json": result,
                           "decision-id": decision["decision_id"].encode()}.items():
        with (archive / name).open("xb") as f:
            f.write(contents)
    for link in links:
        (archive / (link["kind"] + ".link.json")).write_text(json.dumps(link))
    return {"scope": "review/attestation only", "proof": archive.name, "attestations": links,
            "denials": ["missing-auth", "wrong-auth", "wrong-subject", "tampered", "replay", "expired"]}
