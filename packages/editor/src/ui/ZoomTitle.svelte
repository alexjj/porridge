<script lang="ts">
  import type { ENode } from "../model/tree.js";
  import { pasteAsLink } from "../store/commands.js";
  import { handleKey } from "../store/keys.js";
  import type { Workspace } from "../store/workspace.svelte.js";

  /** The zoomed-in line, shown as the page title and edited in place. */
  let { ws, node }: { ws: Workspace; node: ENode } = $props();

  const editing = $derived(ws.editingId === node.id);
  let ta: HTMLTextAreaElement | undefined = $state();

  function autosize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }

  $effect(() => {
    void node.text;
    if (editing) autosize();
  });

  function onBlur() {
    const id = node.id;
    setTimeout(() => {
      if (ws.editingId === id && document.activeElement?.id !== `ta-${id}`) ws.editingId = null;
    });
  }

  // A title is one line: pasted line breaks become spaces.
  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (ta && pasteAsLink(e, ws, node, ta, text)) return;
    if (!text.includes("\n") || !ta) return;
    e.preventDefault();
    const flat = text.replace(/\s*[\r\n]+\s*/g, " ").trim();
    const start = ta.selectionStart;
    const value = ta.value.slice(0, start) + flat + ta.value.slice(ta.selectionEnd);
    ta.value = value;
    ws.setText(node, value);
    ta.setSelectionRange(start + flat.length, start + flat.length);
  }
</script>

{#if editing}
  <textarea
    bind:this={ta}
    id="ta-{node.id}"
    class="title-input"
    rows="1"
    aria-label="Title"
    value={node.text}
    oninput={(e) => {
      ws.setText(node, e.currentTarget.value);
      autosize();
    }}
    onkeydown={(e) => ta && handleKey(e, ws, node, ta)}
    onpaste={onPaste}
    onblur={onBlur}
  ></textarea>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <span
    class="title-text"
    class:empty={node.text === ""}
    role="textbox"
    tabindex="0"
    aria-label="Title"
    onmousedown={(e) => e.preventDefault()}
    onclick={(e) => {
      const link = (e.target as HTMLElement).closest("a");
      if (link) {
        e.preventDefault();
        window.open(link.href, "_blank", "noopener");
        return;
      }
      ws.focusNode(node.id, node.text.length);
    }}
    onfocus={() => ws.focusNode(node.id, node.text.length)}
    onkeydown={() => {}}
  >
    {@html ws.renderText(node.text) || "Untitled"}
  </span>
{/if}
