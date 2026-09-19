import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Guard tests for the UI/UX conventions established by the feedback pass.
 *
 * These are repository scans rather than runtime assertions because the rules
 * are architectural: every async action must show real state, placeholders must
 * be shaped like the content they replace, and there must be exactly one
 * navigation implementation. A regression here is a copy-paste away, and it is
 * invisible in a typecheck.
 */

const repoRoot = path.resolve(__dirname, "../../..");
const read = (...segments: string[]) => fs.readFileSync(path.join(repoRoot, ...segments), "utf8");

function listFiles(dir: string, extensions: string[]): string[] {
  const absolute = path.join(repoRoot, dir);
  if (!fs.existsSync(absolute)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(relative, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) out.push(relative);
  }
  return out;
}

const uiFiles = listFiles(path.join("src", "app"), [".tsx"]).concat(
  listFiles(path.join("src", "components"), [".tsx"]),
);

describe("Async feedback is real, never faked", () => {
  it("has no browser alert() or confirm() left in the UI", () => {
    // Native dialogs are unstyled, block the main thread, cannot be made
    // accessible and are untestable. Destructive actions use ConfirmDialog and
    // failures use StatusMessage.
    const offenders = uiFiles.filter((file) => {
      const code = read(file)
        // Prose in comments and copy may legitimately say "confirm".
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // A file that declares its own `confirm` (a dialog's submit handler) has
      // shadowed the global, so calls to it are not the browser dialog.
      const shadowsConfirm = /function\s+confirm\s*\(|const\s+confirm\s*=/.test(code);
      const names = shadowsConfirm ? "alert" : "alert|confirm";
      return new RegExp(`(?<![\\w.])(?:window\\.)?(?:${names})\\(`).test(code)
        // window.confirm is never acceptable, shadowed or not.
        || /window\.(alert|confirm)\(/.test(code);
    });
    expect(offenders, "use ConfirmDialog / StatusMessage instead of window.alert or window.confirm").toEqual([]);
  });

  it("never uses a timer to simulate or clear progress", () => {
    // setTimeout is legitimate for debouncing and for deferring focus to the
    // next frame; it is not legitimate as a stand-in for a request's duration,
    // which is what an arbitrary multi-hundred-millisecond delay always is.
    const offenders: string[] = [];
    for (const file of uiFiles) {
      const source = read(file);
      for (const match of source.matchAll(/setTimeout\([\s\S]{0,400}?,\s*(\d+)\s*\)/g)) {
        const delay = Number(match[1]);
        // 0ms = "after this render" (deferring focus), which is fine.
        if (delay < 100) continue;
        // Input debouncing is a real technique with a real purpose, and it is
        // always named as such at its call site.
        const context = source.slice(Math.max(0, match.index! - 300), match.index! + match[0].length);
        if (/debounce|Debounce|DEBOUNCE_MS/.test(context)) continue;
        offenders.push(`${file} (${delay}ms)`);
      }
    }
    expect(offenders, "loading state must track the real request, not a timer").toEqual([]);
  });

  it("routes every button's busy state through the Button loading prop", () => {
    // The old idiom `{saving && <Spinner />} Save` rendered a spinner but left
    // the button without aria-busy, and relied on a separate `disabled`
    // expression that was easy to forget — so the action stayed double-clickable.
    const offenders = uiFiles.filter((file) => /\{\s*\w+\s*&&\s*<Spinner\s*\/?>/.test(read(file)));
    expect(offenders, "use <Button loading={…} loadingText=\"…\"> instead of a manual spinner").toEqual([]);
  });

  it("does not ship a generic full-page skeleton", () => {
    // Removed deliberately: it was used on 51 screens as a stand-in for tables,
    // forms, dashboards and detail panels alike, so it always caused a jump.
    const ui = read("src", "components", "ui.tsx");
    expect(ui).not.toMatch(/export function LoadingSkeleton\b/);
    // ui.tsx keeps a comment explaining the removal; a JSX usage is what fails.
    const offenders = uiFiles.filter((file) => /<LoadingSkeleton[\s/>]|\bLoadingSkeleton\b\s*[,}]/.test(read(file)));
    expect(offenders, "use the shaped skeleton that matches the content").toEqual([]);
  });

  it("exports a shaped skeleton for every kind of content the app renders", () => {
    const ui = read("src", "components", "ui.tsx");
    for (const name of [
      "TableSkeleton", "CardSkeleton", "CardListSkeleton", "StatCardsSkeleton",
      "FormSkeleton", "TextBlockSkeleton", "DetailSkeleton", "DashboardSkeleton",
    ]) {
      expect(ui, `${name} must exist`).toMatch(new RegExp(`export function ${name}\\b`));
    }
  });

  it("gives every skeleton an accessible status role", () => {
    const ui = read("src", "components", "ui.tsx");
    for (const match of ui.matchAll(/export function (\w*Skeleton)\b([\s\S]*?)\n}/g)) {
      const [, name, body] = match;
      // CardSkeleton is a leaf rendered inside CardListSkeleton's status region;
      // nesting a second role="status" would double-announce it.
      if (name === "CardSkeleton") continue;
      expect(body, `${name} must be announced to assistive technology`).toMatch(/role="status"/);
    }
  });
});

describe("One navigation implementation, shared by every role", () => {
  it("defines the shell exactly once and exports a single AppShell", () => {
    const shell = read("src", "components", "shell.tsx");
    expect(shell.match(/export function AppShell\b/g)).toHaveLength(1);
    // Role-specific nav is data (an array of items), never a second component.
    expect(shell).toMatch(/ADMIN_NAV/);
    expect(shell).toMatch(/TEACHER_NAV/);
    expect(shell).toMatch(/STUDENT_NAV/);
  });

  it("every role layout renders that same shell", () => {
    const layouts = [
      ["src", "app", "(admin)", "layout.tsx"],
      ["src", "app", "(teacher)", "layout.tsx"],
      ["src", "app", "(student)", "layout.tsx"],
    ] as const;
    for (const layout of layouts) {
      expect(read(...layout), `${layout.join("/")} must use the shared AppShell`).toMatch(/AppShell/);
    }
  });

  it("the mobile drawer handles escape, outside clicks and background scroll", () => {
    const shell = read("src", "components", "shell.tsx");
    expect(shell, "Escape must close the drawer").toMatch(/"Escape"/);
    expect(shell, "the drawer must lock background scrolling").toMatch(/body\.style\.overflow/);
    expect(shell, "the open drawer must be a labelled modal dialog").toMatch(/role: "dialog"|role="dialog"/);
    expect(shell, "the drawer must be labelled").toMatch(/aria-label=\{`\$\{portalLabel\} navigation`\}/);
    expect(shell, "the drawer must trap focus").toMatch(/"Tab"/);
  });

  it("persists the desktop collapse preference under a namespaced key", () => {
    expect(read("src", "components", "shell.tsx")).toMatch(/ems\.nav\.collapsed/);
  });
});

describe("Notice recipient selection stays server-scoped", () => {
  it("the composer never fetches an unbounded recipient list", () => {
    const composer = read("src", "components", "notices", "notice-composer.tsx");
    // Every option list is paged through the search endpoint.
    expect(composer).toMatch(/notices\/recipients/);
    expect(composer).not.toMatch(/limit=1000|limit=500/);
  });

  it("the recipients route still re-checks the role on every kind", () => {
    const route = read("src", "app", "api", "v1", "notices", "recipients", "route.ts");
    expect(route).toMatch(/requireAuth/);
    // Teachers must never be able to enumerate teachers.
    expect(route).toMatch(/TEACHER/);
    expect(route).toMatch(/ADMIN/);
  });

  it("the save path validates target IDs independently of the picker", () => {
    // The pickers are a convenience; resolveTargets is the boundary.
    const service = read("src", "modules", "notices", "notices.service.ts");
    // Not exported: it is called internally by createNotice/updateNotice so it
    // cannot be bypassed by another code path.
    expect(service).toMatch(/async function resolveTargets\(auth: AuthContext/);
    expect(service).toMatch(/resolveTargets\(/g);
  });
});
