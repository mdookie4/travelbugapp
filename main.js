// load the libs
const express = require('express')
const handlebars = require('express-handlebars')
const fetch = require('node-fetch')
const withQuery = require('with-query').default
/* const rateLimit = require('express-rate-limit')
const slowDown = require('express-slow-down') */
const poller = require('./poller')
const urlSigner = require('./urlSigner')
const Amadeus = require('amadeus')

// configure the PORT
const PORT = parseInt(process.argv[2]) || parseInt(process.env.PORT) || 3000
//API keys
const OWM_API_KEY = process.env.OWM_API_KEY
const OWM_URL = 'https://api.openweathermap.org/data/2.5/weather'
const NEWS_API_KEY = process.env.NEWS_API_KEY
const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET
const GOOGLE_MAP_API_KEY = process.env.GOOGLE_MAP_API_KEY
const GOOGLE_MAP_SECRET_KEY = process.env.GOOGLE_MAP_SECRET_KEY
//urls
const NEWS_URL = 'https://newsapi.org/v2/top-headlines'
//const GEODB_CITY_URL = 'https://wft-geo-db.p.rapidapi.com/v1/geo/cities'
const GEODB_COUNTRY_URL = 'https://wft-geo-db.p.rapidapi.com/v1/geo/countries'
const CURR_XCHANGE_URL = 'https://api.exchangeratesapi.io/latest'
const GOOGLE_MAP_URL = 'https://maps.googleapis.com/maps/api/staticmap'

// create an instance of express
const app = express()

// configure handlebars
app.engine('hbs', handlebars({ defaultLayout: 'bootstrap_default.hbs' }))
app.set('view engine', 'hbs')

//configure amadeus
const amadeus = new Amadeus({
    clientId: AMADEUS_API_KEY,
    clientSecret: AMADEUS_API_SECRET
})

//configure rate limit and slow down
//app.set('trust proxy', 1) //for heroku
/* const rateLimiter = rateLimit({
    windowMs: 1*1000,
    max: 1,
    message: 'Rate limit exceeded',
    headers: true
})
const speedLimiter = slowDown({
    windowMs: 1*1000,
    delayAfter: 1,
    delayMs: 1000
}) */

//configure variables
const jobQueue = []

//custom functions
const isEmpty = (obj) => {
    return !Object.keys(obj).length
}

//Setup caching for responses back from GeoDB

//mount media folder
app.use(express.static(__dirname + '/media'))

// configure app
app.get('/', (req, resp) => {
    const coverImg = (Math.floor(Math.random() * 5)+1)+'.jpg'
    //console.info("coverImg: ", coverImg)
    resp.status(200)
    resp.type('text/html')
    resp.render('bootstrap_index', {
        coverImg
    })
})

app.get('/comingsoon', (req,resp)=>{
    resp.status(200)
    resp.type('text/html')
    resp.render('comingsoon')
})

app.get('/search', async (req,resp)=>{
    const search = req.query['search-city']
    var countryCode, currencyCode, currencyXinfo, currencyXrate, cityPosition
    var poiArray = []

    //get cover image
    const coverImg = (Math.floor(Math.random() * 5)+1)+'.jpg'

    //Getting weather...
    const omw_url = withQuery(OWM_URL, {
        appid: OWM_API_KEY,
        q: search,
        units: 'metric'
    })

    const omw_result = await fetch(omw_url)
    const weather_result = await omw_result.json()
    console.info("weather: ", weather_result.weather[0])
    countryCode = weather_result.sys.country
    //console.info("countryCode from OMW: ", countryCode)
    cityPosition = weather_result.coord 
    console.info("city Pos: ", cityPosition)

    //Getting news...
    const news_url = withQuery(NEWS_URL, {
        apiKey: NEWS_API_KEY,
        q: search
    })
    const news_result = await fetch(news_url)
    const headlines_result = await news_result.json()
    //console.info("news headlines: ", headlines_result.articles)

    //Getting country, then currency
    const headers = {
        'x-rapidapi-key': 'ccaec34635msh0fc1539e26e2ea2p1df043jsn8f345e1404bb',
        'x-rapidapi-host': 'wft-geo-db.p.rapidapi.com',
        useQueryString: true
      }
/*     const city_url = withQuery(GEODB_CITY_URL, {
        namePrefix: search
    })
    //push fetch job into job queue
    jobQueue.push(
        async() => {
            const city_result = await fetch(city_url, {headers})
            const cityinfo_result = await city_result.json()
            console.info("city results: ", cityinfo_result.data[0].countryCode)
            countryCode = cityinfo_result.data[0].countryCode
        }
    ) */
    /* const city_result = await fetch(city_url, {headers})
    const cityinfo_result = await city_result.json()
    //console.info("city results: ", cityinfo_result.data[0].countryCode)
    const countryCode = cityinfo_result.data[0].countryCode + 'D' */
    
    // const country_url = GEODB_COUNTRY_URL + '/' + countryCode
    // console.info("country url: ", country_url)

    jobQueue.push(
        async()=> {
            const country_url = GEODB_COUNTRY_URL + '/' + countryCode
            //console.info("country url: ", country_url)
            const country_result = await fetch(country_url, {headers})
            const countryinfo_result = await country_result.json()
            console.info("country result: ", countryinfo_result )
            currencyCode = countryinfo_result.data.currencyCodes[0]
        }
    )

    jobQueue.push(
        async() => {
            const currency_url = withQuery(CURR_XCHANGE_URL, {
                base: 'SGD',
                symbols: currencyCode
            })
            const currency_result = await fetch(currency_url)
            currencyXinfo = await currency_result.json()
            //console.info("currencyXinfo has currency: ", ('error' in currencyXinfo))
            if('error' in currencyXinfo) 
                currencyXrate = 0
            else   
                currencyXrate = currencyXinfo.rates[currencyCode].toFixed(2)
        }
    )

    //POIs
    jobQueue.push(
        async() => {
            try {
                    const poiResults = await amadeus.referenceData.locations.pointsOfInterest.get({
                    longitude: cityPosition.lon, latitude: cityPosition.lat
                })
                console.info("POI results: ", poiResults.data)  
                poiArray = poiResults.data.map ( item => {
                    return { name: item.name, rank: item.rank}
                })
                console.info("POI array: ", poiArray.length)
            }
            catch(e) {
                console.info("POI error: ", e)
            }
        }
    )

    //Get Google static map
    const google_static_map_url = withQuery(GOOGLE_MAP_URL, {
        center: cityPosition.lat + '%2c%20' + cityPosition.lon,
        zoom: 12,
        size: '400x400',
        key: GOOGLE_MAP_API_KEY
    }, {
        stringifyOpt: {
            encode: false
        }
    })
    //get Google map digital signature
    const urlGMap = urlSigner(google_static_map_url, GOOGLE_MAP_SECRET_KEY)
    console.info("google url: ", urlGMap)

    //Compile info...
    jobQueue.push(
        async() => {
            console.info("poi array length: ", poiArray.length)
            resp.status(200)
            resp.type('text/html')
            resp.render('bootstrap_results', {
                hasResult: weather_result.weather.length > 0,
                weather: weather_result.weather[0],
                weather_description: weather_result.weather[0].main='Clouds'?'Cloudy':weather_result.weather[0].main,
                weather_temp_min: parseInt(weather_result.main.temp_min),
                weather_temp_max: parseInt(weather_result.main.temp_max),
                hasNews: headlines_result.articles.length > 0,
                news: headlines_result.articles,
                currencyXinfo: currencyXrate,
                currencyCode: countryCode,
                hasCurrency: !('error' in currencyXinfo),
                hasPOI: parseInt(poiArray.length) > 0,
                POI: poiArray,
                mapimg: urlGMap,
                coverImg
            })
        }
    )

})



if (OWM_API_KEY && NEWS_API_KEY)
    app.listen(PORT, () => {
        console.info(`Application started on port ${PORT} at ${new Date()}`)
        console.info(`with omw key ${OWM_API_KEY} and news key ${NEWS_API_KEY}`)
        poller(jobQueue, 5000)
    })
else
    console.error('API_KEY is not set')