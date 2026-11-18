import { mount } from "svelte";
import App from "./ui/App.svelte";
import { Workspace } from "./store/workspace.svelte.js";
import "./styles.css";

const ws = new Workspace();
mount(App, { target: document.getElementById("app")!, props: { ws } });
void ws.load();
