# Verify the proposed change

Each case in changes.json represents the current diff in a separate fixture repository. Work from the directory containing checks.py. Run `python3 checks.py CASE CHECK` for each applicable check. For application or schema changes use lint, types and unit. For documentation use docs. For a test-only change run unit. For schema changes start with generate and retain the generated snapshot in the working directory. Report the exact failure or unavailable check and whether the change is ready to commit. Leave the commit to the caller.
