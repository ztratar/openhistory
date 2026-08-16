// Stable compatibility facade. Internal inference modules may move without
// forcing coordinators, tests, or downstream integrations to change imports.
export * from "./inference/service";
export * from "./inference/tasks";
