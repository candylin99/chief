// chief undo [--list] [号]：撤回最近做的（不做了、只记下 / 忽略、跳过积下的）。不写号就撤最近一笔还没撤过的。见 undo.ts。
import { fail, num } from "../args";
import { loadUndo, undoEntry } from "../undo";

export function undoCmd(args: string[]): void {
  if (args.includes("--list")) {
    process.stdout.write(`${JSON.stringify([...loadUndo().items].reverse(), null, 2)}\n`);
    return;
  }
  const items = loadUndo().items;
  const entry = args[0] === undefined
    ? [...items].reverse().find((x) => !x.undone) ?? fail("没有能撤回的")
    : (() => {
      const id = num(args[0], "撤回号");
      return items.find((x) => x.id === id) ?? fail(`没有这一笔：${id}（chief undo --list 看有哪些）`);
    })();
  process.stdout.write(`${undoEntry(entry)}\n`);
}
