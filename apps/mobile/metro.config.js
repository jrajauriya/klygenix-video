const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")
const fs = require("fs")

const workspace = path.resolve(__dirname, "../..")
const config = getDefaultConfig(__dirname)

config.watchFolders = [workspace]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(workspace, "node_modules"),
]

const local = path.resolve(__dirname, "node_modules")
const pinned = ["react"].filter((name) => fs.existsSync(path.join(local, name, "package.json")))
const fallback = config.resolver.resolveRequest

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const owner = pinned.find((name) => moduleName === name || moduleName.startsWith(`${name}/`))
  if (owner) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(__dirname, "index.js") },
      moduleName,
      platform,
    )
  }
  return fallback ? fallback(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform)
}

module.exports = config
