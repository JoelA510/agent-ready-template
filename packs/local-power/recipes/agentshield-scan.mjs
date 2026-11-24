// Local static scanner entrypoint. Keep its SARIF for inspection and enforce severity explicitly.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [cli, command, pathFlag, target, outputFlag, file, ...extra] = process.argv.slice(2)
if (command !== 'scan' || pathFlag !== '--path' || !target || outputFlag !== '--output' || !file || extra.length) {
  throw Error('Usage: agentshield scan --path CONFIG_DIRECTORY --output NEW_REPORT.sarif')
}
const output = resolve(file)
if (existsSync(output)) throw Error('Choose a new report path')
const result = spawnSync(process.execPath, [cli, 'scan', '--path', resolve(target), '--format', 'sarif', '--output', output, '--min-severity', 'high'], { stdio: 'ignore' })
if (result.error) throw result.error
if (result.signal || ![0, 2].includes(result.status)) throw Error('AgentShield could not finish the scan')
const [run] = JSON.parse(readFileSync(output, 'utf8')).runs
if (run?.tool?.driver?.name !== 'AgentShield' || run.invocations?.[0]?.executionSuccessful !== true ||
    !Number.isSafeInteger(run.properties?.filesScanned) || run.properties.filesScanned < 1 || !Array.isArray(run.results)) throw Error('AgentShield returned an incomplete scan')
const blocked = run.results.filter(r => ['high', 'critical'].includes(r.properties?.severity))
console.log(JSON.stringify({ scanned: run.properties.filesScanned, highOrCritical: blocked.length, output }))
process.exitCode = blocked.length ? 1 : 0
