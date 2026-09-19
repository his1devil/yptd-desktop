import { describe, expect, it } from 'vitest'
import { planImage, randomObjectName } from './prepare'

const MB = 1024 * 1024

describe('发图之前怎么处理', () => {
  it('小的 JPEG 原样发：重编码只会白白损失一代画质', () => {
    expect(planImage({ ext: 'jpg', width: 1200, height: 900, bytes: 300_000 })).toEqual({ kind: 'keep' })
  })
  it('手机原片：缩到 2048、JPEG q82', () => {
    expect(planImage({ ext: 'JPEG', width: 6048, height: 4032, bytes: 5 * MB }))
      .toEqual({ kind: 'encode', edge: 2048, format: 'jpeg', quality: 82 })
  })
  it('尺寸不大但体积大的 JPEG 也要重编码', () => {
    expect(planImage({ ext: 'jpg', width: 2000, height: 1500, bytes: 4 * MB }))
      .toEqual({ kind: 'encode', edge: null, format: 'jpeg', quality: 82 })
  })
  it('截图保持 PNG：转 JPEG 字会糊、透明底变黑', () => {
    expect(planImage({ ext: 'png', width: 1440, height: 900, bytes: 400_000 })).toEqual({ kind: 'keep' })
    expect(planImage({ ext: 'png', width: 5120, height: 2880, bytes: 3 * MB }))
      .toEqual({ kind: 'encode', edge: 2048, format: 'png', quality: 100 })
  })
  it('动图和解不出来的不碰', () => {
    expect(planImage({ ext: 'gif', width: 800, height: 600, bytes: 9 * MB })).toEqual({ kind: 'keep' })
    expect(planImage({ ext: 'heic', width: 0, height: 0, bytes: 2 * MB })).toEqual({ kind: 'keep' })
  })
  it('webp 之类统一成 JPEG，别的端不一定解得开', () => {
    expect(planImage({ ext: 'webp', width: 1000, height: 1000, bytes: 200_000 }))
      .toEqual({ kind: 'encode', edge: null, format: 'jpeg', quality: 82 })
  })
})

describe('对象名', () => {
  it('随机 id 加扩展名，不带原始文件名', () => {
    const n = randomObjectName('.PNG')
    expect(n).toMatch(/^[a-z2-7]{26}\.png$/)
    expect(randomObjectName('png')).not.toBe(n)
  })
  it('没有扩展名也行；扩展名里的怪字符去掉', () => {
    expect(randomObjectName('')).toMatch(/^[a-z2-7]{26}$/)
    expect(randomObjectName('j/p g')).toMatch(/\.jpg$/)
  })
})
