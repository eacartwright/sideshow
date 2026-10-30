# AI cleanup templates

What ✨ Clean up tells the model (DESIGN.md §11). The server reads these files on every
cleanup, so a change shows on the next ✨ or Compare without a restart.

- `rules.md`: the rules every template goes with. The model gets these first, then
  "The shape of the notes:" and the template.
- `<number>-<id>.md`: one template each, in number order; **the first is the default**. The
  first line is `# Its name` (what the menus show); everything under it is the instructions.
  The id is the file name without the number (`01-communication.md` → `communication`).
  Sessions record the template's name, so renaming or renumbering one breaks nothing.
- `<!-- comments -->` in any of them are notes to yourself; the model doesn't see them.
- Other files here (like this one) are ignored.

CW shows "* " as bullets, not "- ", so say "* " wherever bullets come up.
