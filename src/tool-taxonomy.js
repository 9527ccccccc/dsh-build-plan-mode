// Single classification authority for the monotonic guard and the Research
// Child prohibitions. Data only: six named classes, and every classified
// tool name is declared here exactly once. The child never-set composes
// everything outside observation, so a future relaxation of the parent Plan
// allowlist alone can never admit these classes for a child.
export const TOOL_CLASSES = Object.freeze({
  observation: Object.freeze([
    'cordis_inspect_list',
    'cordis_inspect_query',
    'cordis_inspect_self',
    'get_goal',
    'glob',
    'grep',
    'job_list',
    'job_output',
    'list_agents',
    'preset_roster_list',
    'read',
    'read_image',
    'skill',
    'web_search',
  ]),
  orchestration: Object.freeze(['subagent', 'subagent_fork', 'workflow', 'ralph', 'send_message']),
  agentControl: Object.freeze(['job_kill', 'interrupt_agent']),
  goalMutation: Object.freeze(['create_goal', 'update_goal']),
  runtimeMutation: Object.freeze(['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine']),
  interpreter: Object.freeze(['pwsh', 'bash', 'terminal', 'run_code']),
})

export const PLAN_OBSERVATION_TOOLS = TOOL_CLASSES.observation

export const CHILD_NEVER_TOOLS = Object.freeze([
  ...TOOL_CLASSES.orchestration,
  ...TOOL_CLASSES.agentControl,
  ...TOOL_CLASSES.goalMutation,
  ...TOOL_CLASSES.runtimeMutation,
  ...TOOL_CLASSES.interpreter,
])

// The continuable-child creation pair. These are the only orchestration tools
// the parent may exercise in Plan mode, and only in background form, so their
// argument rule keys off this pair rather than the whole class.
export const CHILD_CREATING_TOOLS = Object.freeze(['subagent', 'subagent_fork'])

// The single ownership-scoped interruption channel: the only agent-control
// tool whose direct-child interruption path stays reachable in Plan.
export const CHILD_INTERRUPT_TOOL = 'interrupt_agent'
