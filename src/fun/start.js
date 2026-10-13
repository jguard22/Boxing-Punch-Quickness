// Wires the Fight view: the screens (ui.js) and the game (session.js) on top of the page that app.js already built.
import { createView } from "./ui.js";
import { createSession } from "./session.js";

createSession({ view: createView() }).start();
