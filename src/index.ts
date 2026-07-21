import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerGreptileTools } from "./tools.ts";

export default function (pi: ExtensionAPI): void {
	registerGreptileTools(pi);
}
