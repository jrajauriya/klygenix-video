const modules = import.meta.glob<{ default: Record<string, string> }>("./*.ts", { eager: true })

const HI: Record<string, string> = {}
for (const [path, mod] of Object.entries(modules)) {
  if (!path.endsWith("/index.ts")) Object.assign(HI, mod.default)
}

export default HI
