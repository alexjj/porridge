import { mount } from "svelte";
import App from "./ui/App.svelte";
import { Remote } from "./store/remote.svelte.js";
import { Workspace } from "./store/workspace.svelte.js";
import "./styles.css";

const ws = new Workspace();
const remote = new Remote(ws);
mount(App, { target: document.getElementById("app")!, props: { ws, remote } });
await ws.load();
await remote.load();
