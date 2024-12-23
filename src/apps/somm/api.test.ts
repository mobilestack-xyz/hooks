import { calculateApy } from './api'
import { mockDayDatas, mockDayDatasFixedShareValue } from './testData'

describe('calculateApy', () => {
  it('should return undefined if apyEnabled is false', () => {
    const result = calculateApy({
      data: mockDayDatas,
      windowSize: 30,
      apyEnabled: false,
    })

    expect(result).toBeUndefined()
  })

  it('should return undefined if data is undefined', () => {
    const result = calculateApy({
      data: undefined,
      windowSize: 30,
      apyEnabled: true,
    })

    expect(result).toBeUndefined()
  })

  it('should return undefined if data length is less than the window size', () => {
    const result = calculateApy({
      data: Array.from({ length: 29 }, (_, i) => ({
        date: i,
        shareValue: '1.0',
      })),
      windowSize: 30,
      apyEnabled: true,
    })

    expect(result).toBeUndefined()
  })

  it('should calculate the correct APY with valid data', () => {
    const result = calculateApy({
      data: mockDayDatas,
      windowSize: 30,
      apyEnabled: true,
    })

    expect(result).toBe(9.90525301915644)
  })

  it('should handle data not sorted by date and still return the correct APY', () => {
    const result = calculateApy({
      data: mockDayDatas.slice().sort(() => Math.random() - 0.5), // shuffle the array
      windowSize: 30,
      apyEnabled: true,
    })

    expect(result).toBe(9.90525301915644)
  })

  it('should return the estimatedApy if the calculated apy from data is 0', () => {
    const result = calculateApy({
      data: mockDayDatasFixedShareValue,
      windowSize: 30,
      apyEnabled: true,
      estimatedApy: 1.6,
    })

    expect(result).toBe(1.6)
  })

  it('should return estimatedApy if it is provided and there is no data', () => {
    const result = calculateApy({
      data: [],
      windowSize: 30,
      apyEnabled: true,
      estimatedApy: 1.6,
    })

    expect(result).toBe(1.6)
  })
})
