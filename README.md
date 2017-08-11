# Coinbase API Client

Unofficial JS library for the [Coinbase API](https://developers.coinbase.com/api/v2).

# Why?

Because I didn't enjoy using the official one.

# How to use

Import the library.

```
const coinbase = require('./coinbase-api-client.js')
```

Create a client to interact with the API. Refer to the code for available methods.

```
const client = new coinbase.CoinbaseClient({
  'apiKey': COINBASE_API_KEY,
  'apiSecret': COINBASE_API_SECRET
})
```

Create a client to interact with Coinbase on behalf of a user. You need to create an OAuth app in Coinbase, get the clientId and clientSecret. Get the accessToken and refreshToken through the OAuth dance.

```
const client = new coinbase.CoinbaseClient({
  'clientId': COINBASE_CLIENT_ID,
  'clientSecret': COINBASE_CLIENT_SECRET,
  'accessToken': ACCESS_TOKEN,
  'refreshToken': REFRESH_TOKEN
})
```

# Events

Below and example on how to handle the didRefreshToken event to update the refreshToken in your database.

```
  client.on('didRefreshToken', (res) => {
    user.coinbase.accessToken = res.access_token
    user.coinbase.refreshToken = res.refresh_token
    user.coinbase.expiresAt = new Date((new Date()).getTime() + res.expires_in * 1000)
    user.coinbase.updatedAt = new Date()
    return user.save()
  })
```
