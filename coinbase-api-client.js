const crypto = require('crypto')
const request = require('request')
const assign = require('assign-deep')

const COINBASE_API = 'https://api.coinbase.com'

class ExpiredTokenError extends Error {
  constructor (message) {
    super(message)
    this.name = this.constructor.name
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    } else {
      this.stack = (new Error(message)).stack
    }
  }
}

class CoinbaseBaseClient {
  constructor (options) {
    const {
      apiKey,
      apiSecret,
      accessToken,
      refreshToken,
      clientId,
      clientSecret} = options

    this._apiKey = apiKey
    this._apiSecret = apiSecret

    this._accessToken = accessToken
    this._refreshToken = refreshToken
    this._clientId = clientId
    this._clientSecret = clientSecret
    // TODO: Validate key or token

    this._events = new Map()
  }

  on (eventName, eventFn) {
    this._events.set(eventName, eventFn)
  }

  get isOAuth () {
    return this._accessToken != null
  }

  getDefaultHeaders () {
    return {
      json: true,
      headers: {
        'CB-VERSION': '2016-08-09',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'en'
      }
    }
  }

  getAuthHeaders (path, method, body) {
    if (this.isOAuth) {
      return this.getOAuthHeaders()
    }
    return this.getAPIAuthHeaders(path, method, body)
  }

  getAPIAuthHeaders (path, method, body) {
    const timestamp = Math.floor(Date.now() / 1000)
    const message = timestamp + method + path + ((body) ? JSON.stringify(body) : '')
    const signature = crypto.createHmac('sha256', this._apiSecret).update(message).digest('hex')

    return {
      headers: {
        'CB-ACCESS-KEY': this._apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp
      }
    }
  }

  getOAuthHeaders () {
    return {
      auth: {bearer: this._accessToken}
    }
  }

  async httpRequest (fn, params, refresh = true) {
    const that = this

    function send () {
      return new Promise((resolve, reject) => {
        fn(params, (err, res) => {
          if (err) {
            return reject(err)
          }
          if (that.isOAuth && res.statusCode === 401) {
            return reject(new ExpiredTokenError(JSON.stringify(res.body)))
          }
          if (res.statusCode >= 300) {
            return reject(new Error('HTTP error ' + res.statusCode + ' ' + JSON.stringify(res.body)))
          }
          resolve((res.body.data) ? res.body.data : res.body)
        })
      })
    }

    try {
      return await send(fn, params)
    } catch (err) {
      // Retry just once with refreshed token
      // TODO: Not really elegant, use decorator
      if (err instanceof ExpiredTokenError && refresh === true) {
        const res = await this.refreshToken()
        if (res) {
          return await send(fn, assign(params, this.getOAuthHeaders()))
        }
      } else {
        throw err
      }
    }
  }

  getRequestParams (method, path, body) {
    const url = COINBASE_API + path
    return assign(
      {url: url},
      this.getDefaultHeaders(),
      this.getAuthHeaders(path, method, body),
      (body != null && Object.entries(body).length > 0) ? {body: body} : {}
    )
  }

  httpGet (path, refresh = true) {
    const params = this.getRequestParams('GET', path)
    return this.httpRequest(request.get, params, refresh)
  }

  httpPost (path, body, refresh = true) {
    const params = this.getRequestParams('POST', path, body)
    return this.httpRequest(request.post, params, refresh)
  }

  httpPut (path, body, refresh = true) {
    const params = this.getRequestParams('PUT', path, body)
    return this.httpRequest(request.put, params, refresh)
  }

  httpDelete (path, refresh = true) {
    const params = this.getRequestParams('DELETE', path)
    return this.httpRequest(request.delete, params, refresh)
  }

  async refreshToken () {
    const res = await this.httpPost('/oauth/token', {
      'grant_type': 'refresh_token',
      'client_id': this._clientId,
      'client_secret': this._clientSecret,
      'refresh_token': this._refreshToken
    }, false)

    if (res) {
      this._accessToken = res.access_token
      this._refreshToken = res.refresh_token

      if (this._events.has('didRefreshToken')) {
        await (this._events.get('didRefreshToken'))(res)
      }
    }
    return res
  }

  revokeToken () {
    return this.httpPost('/oauth/revoke', {
      token: this.accessToken
    })
  }
}

class CoinbaseClient extends CoinbaseBaseClient {
  async getBitcoinPrice (type = 'spot') {
    const res = await this.httpGet(`/v2/prices/btc-usd/${type}`)
    return Number(res.amount)
  }

  // User resource

  getUser (userId) {
    return this.httpGet(`/v2/users/${userId}`)
  }

  getCurrentUser () {
    return this.httpGet('/v2/user')
  }

  getUserAuth () {
    return this.httpGet('/v2/user/auth')
  }

  updateCurrentUser (params) {
    return this.httpPut('/v2/user', params)
  }

  // Account resource

  listAccounts () {
    return this.httpGet('/v2/accounts')
  }

  getAccount (accountId) {
    return this.httpGet(`/v2/accounts/${accountId}`)
  }

  createAccount (params) {
    return this.httpPost('/v2/accounts', params)
  }

  setPrimaryAccount (accountId) {
    return this.httpPost(`/v2/accounts/${accountId}/primary`)
  }

  updateAccount (accountId, params) {
    return this.httpPut(`/v2/accounts/${accountId}`, params)
  }

  deleteAccount (accountId) {
    return this.httpDelete(`/v2/accounts/${accountId}`)
  }

  // Address resource

  listAddresses (accountId) {
    return this.httpGet(`/v2/accounts/${accountId}/addresses`)
  }

  showAddress (accountId, addressId) {
    return this.httpGet(`/v2/accounts/${accountId}/addresses/${addressId}`)
  }

  listAddressTransactions (accountId, addressId) {
    return this.httpGet(`/v2/accounts/${accountId}/addresses/${addressId}/transactions`)
  }

  createAddress (accountId, params) {
    return this.httpPost(`/v2/accounts/${accountId}/addresses`, params)
  }

  // Transaction resource

  listTransactions (accountId) {
    return this.httpGet(`/v2/accounts/${accountId}/transactions`)
  }

  getTransaction (accountId, transactionId) {
    return this.httpGet(`/v2/accounts/${accountId}/transactions/${transactionId}`)
  }

  // TODO: 2FA
  sendMoney (accountId, params) {
    return this.httpPost(
      `/v2/accounts/${accountId}/transactions`,
      assign(params, {type: 'send'})
    )
  }

  transferMoney (accountId, params) {
    return this.httpPost(
      `/v2/accounts/${accountId}/transactions`,
      assign(params, {type: 'transfer'})
    )
  }

  requestMoney (accountId, params) {
    return this.httpPost(
      `/v2/accounts/${accountId}/transactions`,
      assign(params, {type: 'request'})
    )
  }

  completeRequestMoney (accountId, transactionId) {
    return this.httpPost(
      `/v2/accounts/${accountId}/transactions/${transactionId}/complete`
    )
  }

  resendRequestMoney (accountId, transactionId) {
    return this.httpPost(
      `/v2/accounts/${accountId}/transactions/${transactionId}/resend`
    )
  }

  cancelRequestMoney (accountId, transactionId) {
    return this.httpDelete(
      `/v2/accounts/${accountId}/transactions/${transactionId}`
    )
  }

  // Helpers

  async findAccountByName (name) {
    const accounts = await this.listAccounts()
    for (const account of accounts) {
      if (account.name === name) {
        return account
      }
    }
  }

  async findOrCreateAccount (name) {
    // Find account
    const account = await this.findAccountByName(name)

    // Account not found, create one
    if (!account) {
      return await this.createAccount({name: name})
    }
    return account
  }

  async findTransaction (accountId, params) {
    const {description} = params
    const items = await this.listTransactions(accountId)
    for (const item of items) {
      if (item.description === description) {
        return item
      }
    }
  }
}

exports.CoinbaseClient = CoinbaseClient
