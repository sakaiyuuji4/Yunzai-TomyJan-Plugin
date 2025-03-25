import fs from 'node:fs'
import tjLogger from './components/logger.js'
import {
  appsPath,
  pluginVer,
  pluginThemeColor,
} from './data/system/pluginConstants.js'
import {
  initAutoTask,
  checkUpdateTask,
} from './model/autoTask.js'

await tjLogger.info(pluginThemeColor('============(≧∇≦)ﾉ============'))
await tjLogger.info(pluginThemeColor(`TJ插件 V${pluginVer} 开始载入~`))

await tjLogger.info(pluginThemeColor('-----------载入模块-----------'))

const files = fs.readdirSync(appsPath).filter((file) => file.endsWith('.js'))

let ret = []

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')

  if (ret[i].status !== 'fulfilled') {
    await tjLogger.error(`载入模块错误：${name}: ${ret[i].reason}`)
    continue
  } else {
    await tjLogger.info(pluginThemeColor(`载入模块成功：${name}`))
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}
await tjLogger.info(pluginThemeColor('载入模块完成!'))
export { apps }

await tjLogger.info(pluginThemeColor('---------载入定时任务---------'))
await initAutoTask()

await tjLogger.info(pluginThemeColor('载入定时任务完成啦!'))

await tjLogger.info(pluginThemeColor('插件载入完成, 欢迎使用~'))
await tjLogger.info(pluginThemeColor('=============================='))

// 起洞就检查一下更新, 推一下体力
// 延迟5s再开始以防止第三方适配器没连接上
setTimeout(() => {
  checkUpdateTask()
}, 5000)
