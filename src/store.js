// 轻量级持久化存储，替代 electron-store 依赖
const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { atomicSave } = require('./activity-store')

class Store {
  constructor() {
    this.path = path.join(app.getPath('userData'), 'config.json')
    this.data = this._load()
  }

  _load() {
    if (!fs.existsSync(this.path)) return {}
    let data
    try {
      data = JSON.parse(fs.readFileSync(this.path, 'utf8'))
    } catch (error) {
      throw new Error(`无法读取配置文件，原文件将保留：${this.path}\n${error.message}`, { cause: error })
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`配置文件格式无效，已停止写入以保护原文件：${this.path}`)
    }
    return data
  }

  get(key) {
    return this.data[key]
  }

  set(key, value) {
    const next = { ...this.data, [key]: value }
    atomicSave(this.path, next)
    this.data = next
  }
}

module.exports = Store
