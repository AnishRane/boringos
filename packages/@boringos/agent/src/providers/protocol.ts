import type { ContextProvider, ContextBuildEvent } from "../types.js";

export const protocolProvider: ContextProvider = {
  name: "protocol",
  phase: "system",
  priority: 100,

  async provide(event: ContextBuildEvent): Promise<string> {
    const { callbackUrl, callbackToken } = event;
    const taskIdParam = event.taskId ? `/${event.taskId}` : "/:taskId";

    return `## Execution Protocol

### Environment Variables
- \`BORINGOS_CALLBACK_URL\` — Base URL for callback API
- \`BORINGOS_CALLBACK_TOKEN\` — Bearer token for authentication
- \`BORINGOS_RUN_ID\` — Current run ID
- \`BORINGOS_AGENT_ID\` — Your agent ID
- \`BORINGOS_TENANT_ID\` — Tenant ID

### Required Steps
1. Update task status to \`in_progress\`
2. Post a brief plan as a comment
3. Do the work
4. Post a completion summary as a comment
5. Update task status to \`done\` when finished, or follow the
   "When you're stuck" procedure below if you can't proceed.

### When you're stuck

You're "stuck" when you cannot make progress in this run regardless
of how many more attempts you make. Examples:
- A capability you'd need isn't in your tools catalog (no Twitter
  connector, no third-party API the framework hasn't wired)
- The task description is genuinely ambiguous and you'd be guessing
- A field, file, or fact the work depends on doesn't exist yet

Do NOT silently re-comment "(no response)" / "(awaiting your input)"
and end your run with status still \`todo\`. The framework treats
\`todo\` as actionable and will re-wake you on the same task — that
loops forever and burns budget.

Instead, do this in order:

1. **Post a final comment** with: what you delivered, what's
   missing, and the specific action the user needs to take.
2. **Mark the task blocked AND hand it back to the user**, in one
   PATCH:
   \`\`\`
   curl -s -X PATCH ${callbackUrl}/api/agent/tasks${taskIdParam} \\
     -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{
       "status": "blocked",
       "assigneeAgentId": null,
       "assigneeUserId": "<the task creator's user id>"
     }'
   \`\`\`
   Use the task's \`createdByUserId\` (read from \`GET /tasks/<id>\`)
   as the new \`assigneeUserId\`. \`status="blocked"\` stops the
   framework's auto-rewake; setting \`assigneeUserId\` makes the
   row appear in that user's "My todos" tab so they see they need
   to act.
3. **End your run.** Don't post additional comments waiting for a
   response.

If the user later replies on this task, that comment will wake you
again with their response in the conversation thread — pick up
from there.

### Task API

**Read task:**
\`\`\`
curl -s ${callbackUrl}/api/agent/tasks${taskIdParam} \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN"
\`\`\`

**Update task status:**
\`\`\`
curl -s -X PATCH ${callbackUrl}/api/agent/tasks${taskIdParam} \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "in_progress"}'
\`\`\`

**Post comment:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/tasks${taskIdParam}/comments \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"body": "Starting work on this task...", "tenantId": "$BORINGOS_TENANT_ID", "authorAgentId": "$BORINGOS_AGENT_ID"}'
\`\`\`

**Record work product:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/tasks${taskIdParam}/work-products \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"kind": "pr", "title": "...", "url": "...", "tenantId": "$BORINGOS_TENANT_ID"}'
\`\`\`

### Delegation

**Create subtask:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/tasks \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "...", "description": "...", "parentId": "${event.taskId ?? ""}", "assigneeAgentId": "...", "tenantId": "$BORINGOS_TENANT_ID"}'
\`\`\`

### Cost Reporting

**Report token usage:**
\`\`\`
curl -s -X POST ${callbackUrl}/api/agent/runs/$BORINGOS_RUN_ID/cost \\
  -H "Authorization: Bearer $BORINGOS_CALLBACK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"inputTokens": 1000, "outputTokens": 500, "model": "...", "tenantId": "$BORINGOS_TENANT_ID", "agentId": "$BORINGOS_AGENT_ID"}'
\`\`\``;
  },
};
