import { describe, expect, it } from 'vitest'
import { rangeUids } from '../../../app/utils/selection'

const uids = [50, 40, 30, 20, 10]

describe('rangeUids', () => {
  it('should select downwards, bounds included', () => {
    expect(rangeUids(uids, 40, 20)).toEqual([40, 30, 20])
  })
  it('should select upwards, bounds included', () => {
    expect(rangeUids(uids, 20, 40)).toEqual([40, 30, 20])
  })
  it('should follow display order, not uid order', () => {
    expect(rangeUids([3, 9, 1, 7], 9, 7)).toEqual([9, 1, 7])
  })
  it('should return the single message when anchor and target are the same', () => {
    expect(rangeUids(uids, 30, 30)).toEqual([30])
  })
  it('should return nothing without an anchor', () => {
    expect(rangeUids(uids, null, 30)).toEqual([])
  })
  it('should return nothing when the anchor or target left the list', () => {
    expect(rangeUids(uids, 99, 30)).toEqual([])
    expect(rangeUids(uids, 30, 99)).toEqual([])
  })
})
