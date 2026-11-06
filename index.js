/**
 * Host half of the macOS notification bundle.
 *
 * The whole feature lives in the Client module (`client.js`): every interaction
 * that blocks the agent — approval, question, plan review — is already
 * projected into the browser as a pending interaction, and a finished turn is
 * projected as `running: true → false`. The renderer's Web Notification API is
 * what turns both into a real macOS notification owned by DeepSeek Harness.
 * This half only keeps the Loader row valid and registers no Host behavior.
 */
export function apply() {}
