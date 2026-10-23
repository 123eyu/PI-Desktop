# Unreleased changes

- Upgrade the Pi agent, model adapters, native-session SDK, and MCP client from
  1.1.0 to 1.3.0. Preserve Desktop compatibility patches, omit foreign-model
  thinking from replay, reject malformed final tool JSON before execution, and
  expose the user-run discriminator to trusted extension startup handlers.
- Keep each session's side-panel browser available while the panel is collapsed,
  another conversation or Settings is visible, or the renderer reloads. Browser
  actions stay on their connected page without stealing focus. Hidden pages use
  an invisible sandboxed backing host; explicit page/session closure and plugin
  disable still release resources. Browser page-count indicators are not part of
  this change.
