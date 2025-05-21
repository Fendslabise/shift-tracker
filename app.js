// app.js
require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const admin = require('firebase-admin')
const app = express()

// Middleware
app.use(bodyParser.urlencoded({ extended: true }))
app.set('view engine', 'ejs')

// Initialisation de Firebase Admin SDK
const serviceAccount = require('./firebase-adminsdk.json') // Clé privée téléchargée

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://shift-tracker-7579b.firebaseio.com' // Remplace ici
})

// Exemple d’utilisation : accès à Firestore
const db = admin.firestore()

app.get('/', (req, res) => {
  res.send('Hello Firebase is initialized!')
})
module.exports = { app, db }