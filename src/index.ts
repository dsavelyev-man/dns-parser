import puppeteer, {Page} from "puppeteer";
import {readFile, appendFileSync, existsSync, writeFileSync} from "fs";
import { join } from "path";
import {input, select} from "@inquirer/prompts";
import {stringify} from "csv-stringify";

const PARSE_URL = "https://www.dns-shop.ru/catalog/17a8d26216404e77/vstraivaemye-xolodilniki";
const GET_PRICES_PATH = "ajax-state/product-buy"
const PATH_JSID = join(process.cwd(), '.cache', 'qrator_jsid')
const PATH_OUT_FILE = join(process.cwd(), "out.csv");
const URL = "https://www.dns-shop.ru"

type Product = {
  name: string|undefined
  price: string|undefined
}

const products: Product[] = []
let currentPage = 0;
let isLastPage = false;

const parse = async (options: {
  qrator_jsid: string
}) => {

  const browser = await puppeteer.launch({
    headless: "new",
  });

  const page = await browser.newPage();

  await page.goto(PARSE_URL + `/?p=${currentPage}`);

  await page.setCookie({
    //требуется для обхода зашиты
    //видимо вот эта штука https://qrator.ru/
    name: "qrator_jsid",
    value: options.qrator_jsid
  });

  //у dns постоянный поток данных на фоне и из-за этого сайт долго считается не загруженным поэтому без await
  //у него есть еще waitUntil но тут не помогает
  page.reload({
    waitUntil: "networkidle2"
  })

  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();

    //какие штуки блочить
    //хотел так же js заблочить, но кто то из файлов вызывает запрос на цены продуктов,
    //я нашел какой то script.js?000000 и presearch-word.js но исключение их не помогает так как там куча взаимосвязей с другими файлами
    const block = [".css", ".png", ".jpg", "https://ank.dns-shop.ru", "https://mc.yandex.ru", "https://www.google-analytics.com"]

    const canBlock = block.reduce((canBlock, value) => url.indexOf(value) !== -1, false)
    if(
      canBlock
    ) {
      return request.abort()
    }


    return request.continue()
  })

  const response = await page.waitForNavigation({
    waitUntil: "networkidle2"
  });

  if(response?.status() === 401) {
    console.error("qrator_jsid истек срок действия или он невалиден")
    return
  }

  await page.waitForSelector(".catalog-products")

  const pushProducts = async () => {
    currentPage = currentPage+1;
    await page.goto(PARSE_URL + `/?p=${currentPage}`, {
      waitUntil: "networkidle2"
    });

    if(isLastPage) return

    const result = await parseProducts(page)
    if(result.length < 18) isLastPage = true;
    products.push(...result)
    console.log(`на странице ${currentPage} собранно ${result.length} продуктов`)
    await pushProducts()
  }

  await pushProducts()

  stringify(products.map(product => ([product.name, product.price])),
    { header: true, columns: { name: "Имя продукта", price: "Цена" } },
    (e, data) => {
      if(e) throw e

      if(existsSync(PATH_OUT_FILE)) {
        writeFileSync(PATH_OUT_FILE, data)
      } else {
        appendFileSync(PATH_OUT_FILE, data)
      }

      // browser.close()
  })
}

const parseProducts = async (page: Page) => {
  const result = await page.evaluate(  () => {
    const products = document.querySelectorAll<HTMLDivElement>(".catalog-product");
    const result: Product[] = []

    products.forEach((product) => {
      const data: Product = {
        name: undefined,
        price: undefined,
      }

      //имя продукта
      data.name = product.querySelector(".catalog-product__name")?.querySelector("span")?.innerText
      //цена продукта
      data.price = product.querySelector<HTMLDivElement>(".product-buy__price")?.innerText

      result.push(data)
    })

    return result
  })

  return result
}

const getJsid = async (): Promise<string> => {
  const answer = await input({
    message: "jsid\nможно взять из cookies на сайте dns-shop.ru\nhttps://ibb.co/0MMLbCb\nqrator_jsid:",
    validate: (value) => {
      if(!value || value.length < 10) return false

      return true
    }
  })

  if(existsSync(PATH_JSID)) {
    writeFileSync(PATH_JSID, answer)
  } else {
    appendFileSync(PATH_JSID, answer)
  }

  return answer
}

readFile(PATH_JSID, async (e, buffer) => {
  let jsid: string;

  if(e && e.code === "ENOENT") {
    jsid = await getJsid()
  } else if (e) {
    throw e
  } else {
    const from = await select({
      message: "Откуда взять qrator_jsid",
      choices: [
        {
          name: "Взять из кэша",
          description: "берет jsid из .cache/qrator_jsid",
          value: "cache"
        },
        {
          name: "Вписать вручную",
          description: "также сохранится в кэш",
          value: "new"
        }
      ]
    })

    if(from === "cache") {
      jsid = buffer.toString()
    } else {
      jsid = await getJsid()
    }
  }

  await parse({
    qrator_jsid: jsid
  })
})

// inquirer.prompt([
//   {
//     type: "list",
//     name: "select",
//     message: "Взять qrator_jsid из .cache?",
//     choices: {
//       cache: "Взять из кэша",
//       input: "Записать новый jsid"
//     },
//   },
// ]).then((answers) => {
  // {
  //   type: "input",
  //     name: "qrator_jsid",
  //   message: "qrator_jsid\nможно взять cookies на сайте\nhttps://ibb.co/0MMLbCb",
  // },
// })
