import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
})
const requests = []
page.on('request', (request) => {
  const url = request.url()
  if (url.includes('kumanga.com') && !url.includes('google-analytics') && !url.includes('yandex') && !url.includes('ads')) {
    requests.push({ method: request.method(), url, resourceType: request.resourceType() })
  }
})
await page.goto('https://www.kumanga.com/mangalist?keywords=frieren&page=1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(10000)
console.log('TITLE', await page.title())
console.log('URL', page.url())
const html = await page.content()
console.log('HTML_LEN', html.length)
console.log(html.slice(0, 2000))
console.log('REQUESTS')
for (const item of requests.slice(0, 120)) {
  console.log(`${item.method} ${item.resourceType} ${item.url}`)
}
await browser.close()
