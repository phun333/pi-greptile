import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerGreptileCommands } from "./commands.ts";
import { registerGreptileTools } from "./tools.ts";

export default function (pi: ExtensionAPI): void {
	registerGreptileTools(pi);
	registerGreptileCommands(pi);
}
