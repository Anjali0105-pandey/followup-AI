// Node can strip TypeScript types on its own, but it does not read tsconfig
// `paths`, and TS source omits file extensions. This resolve hook does both:
// maps the "@/..." alias to the project root and appends ".ts" when the bare
// specifier has no extension.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function withExtension(filePath) {
  if (existsSync(filePath) && path.extname(filePath)) return filePath;
  for (const candidate of [`${filePath}.ts`, `${filePath}.tsx`, path.join(filePath, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return filePath;
}

export async function resolve(specifier, context, nextResolve) {
  // Outside Next, "server-only" resolves to its browser build, which throws on
  // import. The CLI *is* a server context, so neutralise it.
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export{}", shortCircuit: true };
  }

  const isAlias = specifier.startsWith("@/");
  const isRelative = specifier.startsWith(".");
  if (!isAlias && !isRelative) return nextResolve(specifier, context);

  const base = isAlias
    ? path.join(root, specifier.slice(2))
    : path.resolve(path.dirname(new URL(context.parentURL ?? pathToFileURL(root).href).pathname), specifier);

  return nextResolve(pathToFileURL(withExtension(base)).href, context);
}
