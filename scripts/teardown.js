const fs = require('fs')

const teardown = () => {
  console.log('Tests finished! Running global cleanup...')
  const data = fs.readFileSync('.metrics.json', 'utf8')
  console.log(JSON.parse(data))
}

module.exports = teardown
