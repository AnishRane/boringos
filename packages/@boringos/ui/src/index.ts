// Client (framework-agnostic, no React)
export { createBoringOSClient } from "./client.js";
export type {
  BoringOSClient,
  BoringOSClientConfig,
  TaskWithComments,
  ConnectorInfo,
  WorkflowInfo,
  HealthStatus,
  RuntimeModel,
  InboxItem,
  OrgNode,
  AgentStats,
  CompanySkill,
  ModuleInfo,
  ModulePackageInfo,
  ModuleUploadSuccess,
  ModuleUploadError,
  ModuleUploadResult,
  ModuleDeleteSuccess,
  ModuleDeleteError,
  ModuleDeleteResult,
  InstallInfo,
  TeamMember,
  PendingInvitation,
  ActivityRow,
  SettingDefinition,
  SettingsManifest,
} from "./client.js";

// Re-export the core domain types from @boringos/shared so consumers
// of the SDK don't need to depend on shared directly.
export type {
  Agent,
  AgentRun,
  Task,
  TaskComment,
} from "@boringos/shared";

// React provider
export { BoringOSProvider, useClient } from "./provider.js";
export type { BoringOSProviderProps } from "./provider.js";

// React hooks
export {
  useAgents,
  useAgent,
  useAgentStats,
  useAgentActivity,
  useOrgTree,
  useSkills,
  useTeam,
  useActivity,
  useTasks,
  useTask,
  useRuns,
  useRuntimeModels,
  useSettings,
  useSettingsManifest,
  useRoutines,
  useWorkflows,
  useWorkflowRuns,
  useBudgets,
  useCosts,
  useConnectors,
  useProjects,
  useGoals,
  useOnboarding,
  useEvals,
  useInbox,
  useEntityRefs,
  useSearch,
  useHealth,
} from "./hooks.js";

// ── Plugin UI runtime (task_19) ─────────────────────────────────
// Plugin contract types
export type {
  PluginUI,
  PluginElement,
  NavItem,
  EntityPanel,
  EntityAction,
  EntityActionContext,
  SettingsPanel,
  CopilotTool,
  InboxFilter,
  DashboardWidget,
  DashboardWidgetSize,
  DashboardWidgetSlot,
  ModuleInstallEvent,
} from "./contract.js";

// Plugin hooks
export {
  useTool,
  useToolMutation,
  useInstalledModules,
  useInstalledModulesState,
  useInstallModule,
  useUninstallModule,
  useRealtimeEvent,
  useInstallEventSync,
} from "./plugin-hooks.js";
export type { ToolError } from "./plugin-hooks.js";

// Plugin components
export { RequireInstall } from "./plugin-components.js";
export type { RequireInstallProps } from "./plugin-components.js";
