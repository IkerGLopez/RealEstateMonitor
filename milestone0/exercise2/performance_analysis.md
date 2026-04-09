# Performance analysis

## Command run

`python3 analyze_chat.py chat.json --pretty --label "raptor-mini playwright run"`

## Results (from command output)

- `request_count`: 5
- `total_duration_ms`: 602261
- `total_duration_s`: 602.26
- `total_tool_call_count`: 39

## Drill-down stats (per request tool counts)

| request_id | model_id | duration_s | tool_call_count | tool_call_breakdown |
|---|---|---|---|---|
| request_4690fc07-8f5b-4805-8d14-b432e659b854 | copilot/oswe-vscode-prime | 197.4 | 15 | mcp_playwright_browser_navigate=1, copilot_readFile=2, mcp_playwright_browser_run_code=12 |
| request_b170b9d0-1bbf-4dee-afba-565a16c666b5 | copilot/oswe-vscode-prime | 33.71 | 1 | run_in_terminal=1 |
| request_6a797cca-b5d9-4e83-9940-6efaff1a334e | copilot/oswe-vscode-prime | 352.9 | 23 | copilot_readFile=8, run_in_terminal=11, copilot_replaceString=3, copilot_getErrors=1 |
| request_b033ae72-2912-4df5-9051-6cb5361c967d | copilot/oswe-vscode-prime | 9.4 | 0 | {} |
| request_5cea9075-9dc3-4423-97da-e71817e9d5fe | copilot/oswe-vscode-prime | 8.85 | 0 | {} |

## Exit status

- exit code: 0 (success)
