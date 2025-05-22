// app.js
require('dotenv').config()
const express = require('express')
const bodyParser = require('body-parser')
const session = require('express-session')
const admin = require('firebase-admin')
const app = express()

function calculatePay(shift) {
  const date = new Date(shift.date)
  const day = date.getDay() // 6 = samedi

  const startTime = new Date(`${shift.date}T${shift.start}:00`)
  const endTime = new Date(`${shift.date}T${shift.end}:00`)

  let current = new Date(startTime)
  let amount = 0
  let totalMinutes = 0

  while (current < endTime) {
    const next = new Date(current.getTime() + 15 * 60 * 1000)
    const slotEnd = next > endTime ? endTime : next
    const slotDuration = (slotEnd - current) / (1000 * 60) / 60 // en heures

    const hour = current.getHours()
    const minute = current.getMinutes()
    const currentDecimal = hour + minute / 60

    let rate = 14.5
    if (day === 6) {
      rate = 16
    } else if (currentDecimal >= 6.5 && currentDecimal < 8) {
      rate = 17
    }

    amount += slotDuration * rate
    totalMinutes += (slotEnd - current) / (1000 * 60)

    current = next
  }

  const duration = totalMinutes / 60

  return {
    duration: duration.toFixed(2),
    amount: amount.toFixed(2)
  }
}
// Middleware

app.use(bodyParser.urlencoded({ extended: true }))
app.use(session({
  secret: 'shift-tracker-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}))
app.set('view engine', 'ejs')

// Initialisation de Firebase Admin SDK
const serviceAccount = require('./firebase-adminsdk.json') // Clé privée téléchargée

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://shift-tracker-7579b.firebaseio.com' // Remplace ici
})

// Exemple d’utilisation : accès à Firestore
const db = admin.firestore()

// Middleware d'authentification
function authMiddleware(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login')
  }
  next()
}

app.get('/', (req, res) => {
  res.redirect('/dashboard')
})

// Affiche le formulaire d'inscription
app.get('/signup', (req, res) => {
  res.render('signup')
})

// Traite l'inscription
app.post('/signup', async (req, res) => {
  const { email, password } = req.body

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password
    })

    // Optionnel : créer un profil vide dans Firestore
    await db.collection('users').doc(userRecord.uid).set({
      email,
      createdAt: new Date()
    })

    res.send('Utilisateur créé avec succès !')
  } catch (error) {
    console.error(error)
    res.status(400).send('Erreur : ' + error.message)
  }
})
module.exports = { app, db }

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})


// Affiche la page de connexion
app.get('/login', (req, res) => {
  res.render('login')
})

// Traite la connexion via l’API Firebase Auth REST
app.post('/login', async (req, res) => {
  const { email, password } = req.body

  try {
    const apiKey = process.env.FIREBASE_API_KEY // À mettre dans ton .env
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    })

    const data = await response.json()

    if (data.error) {
      return res.status(401).send(`Erreur : ${data.error.message}`)
    }

    req.session.user = {
      email: data.email,
      idToken: data.idToken,
      uid: data.localId
    }

    res.redirect('/dashboard')
  } catch (err) {
    console.error(err)
    res.status(500).send('Erreur interne')
  }
})

// Route protégée dashboard - liste des shifts
app.get('/dashboard', authMiddleware, async (req, res) => {
  const uid = req.session.user.uid

  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1) 
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const { start, end } = req.query

    let startDate = null
    let endDate = null

    if (start && end && start.trim() && end.trim()) {
      startDate = new Date(start)
      endDate = new Date(end)
    } else if (!start && !end) {
      const now = new Date()
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    }

    const queryRef = db.collection('users').doc(uid).collection('shifts')

    let snapshot

    if (startDate && endDate) {
      snapshot = await queryRef
        .where('date', '>=', startDate.toISOString().slice(0, 10))
        .where('date', '<=', endDate.toISOString().slice(0, 10))
        .orderBy('date', 'desc')
        .get()
    } else {
      snapshot = await queryRef.orderBy('date', 'desc').get()
    }
    
      

    const shifts = snapshot.docs.map(doc => {
      const data = doc.data()
      const calc = calculatePay(data)
      return {
        id: doc.id,
        ...data,
        ...calc
      }
    })

    // Calcul des totaux horaires par tarif
    const totals = {
      h17: 0,
      h16: 0,
      h145: 0,
      total: 0
    }

    shifts.forEach(shift => {
      const date = new Date(shift.date)
      const day = date.getDay()

      const startTime = new Date(`${shift.date}T${shift.start}:00`)
      const endTime = new Date(`${shift.date}T${shift.end}:00`)
      let current = new Date(startTime)

      while (current < endTime) {
        const next = new Date(current.getTime() + 15 * 60 * 1000)
        const slotEnd = next > endTime ? endTime : next
        const slotDuration = (slotEnd - current) / (1000 * 60) / 60

        const hour = current.getHours()
        const minute = current.getMinutes()
        const currentDecimal = hour + minute / 60

        let rate = 14.5
        if (day === 6) {
          rate = 16.5
          totals.h16 += slotDuration
        } else if (currentDecimal >= 6.5 && currentDecimal < 8) {
          rate = 17
          totals.h17 += slotDuration
        } else {
          totals.h145 += slotDuration
        }

        totals.total += slotDuration * rate
        current = next
      }
    })

    totals.h17 = totals.h17.toFixed(2)
    totals.h16 = totals.h16.toFixed(2)
    totals.h145 = totals.h145.toFixed(2)
    totals.total = totals.total.toFixed(2)

    res.render('dashboard', {
      user: req.session.user,
      shifts,
      start: startDate ? startDate.toISOString().slice(0, 10) : '',
      end: endDate ? endDate.toISOString().slice(0, 10) : '',
      totals
    })
  } catch (error) {
    console.error(error)
    res.status(500).send('Erreur lors du chargement des shifts.')
  }
})

// Route de déconnexion
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Erreur lors de la déconnexion.')
    }
    res.redirect('/login')
  })
})

// Affiche le formulaire pour ajouter un shift
app.get('/shifts', authMiddleware, (req, res) => {
  res.render('shifts')
})

// Traite l'enregistrement d'un shift
app.post('/shifts', authMiddleware, async (req, res) => {
  const { date, start, end } = req.body
  const uid = req.session.user.uid

  try {
    const shiftRef = db.collection('users').doc(uid).collection('shifts')
    await shiftRef.add({
      date,
      start,
      end,
      createdAt: new Date()
    })
    res.redirect('/dashboard')
  } catch (err) {
    console.error(err)
    res.status(500).send('Erreur lors de l’enregistrement du shift.')
  }
})

app.post('/shifts/delete/:id', authMiddleware, async (req, res) => {
  const uid = req.session.user.uid
  const shiftId = req.params.id

  try {
    await db.collection('users').doc(uid).collection('shifts').doc(shiftId).delete()
    res.redirect('/dashboard')
  } catch (err) {
    console.error(err)
    res.status(500).send('Erreur lors de la suppression du shift.')
  }
})

app.get('/shifts/edit/:id', authMiddleware, async (req, res) => {
  const uid = req.session.user.uid
  const shiftId = req.params.id

  try {
    const doc = await db.collection('users').doc(uid).collection('shifts').doc(shiftId).get()
    if (!doc.exists) return res.status(404).send("Shift introuvable")
    res.render('edit-shift', { shift: { id: shiftId, ...doc.data() } })
  } catch (err) {
    console.error(err)
    res.status(500).send('Erreur lors du chargement du shift.')
  }
})

app.post('/shifts/edit/:id', authMiddleware, async (req, res) => {
  const uid = req.session.user.uid
  const shiftId = req.params.id
  const { date, start, end } = req.body

  try {
    await db.collection('users').doc(uid).collection('shifts').doc(shiftId).update({
      date,
      start,
      end
    })
    res.redirect('/dashboard')
  } catch (err) {
    console.error(err)
    res.status(500).send('Erreur lors de la mise à jour du shift.')
  }
})

app.get('/profile', authMiddleware, async (req, res) => {
  const uid = req.session.user.uid
  const doc = await db.collection('users').doc(uid).get()
  res.render('profile', { profile: doc.data() || {} })
})

app.post('/profile', authMiddleware, async (req, res) => {
  const uid = req.session.user.uid
  const { nom, prenom, address, phone, email, siret, rib } = req.body

  try {
    await db.collection('users').doc(uid).set({ nom, prenom, address, phone, email, siret, rib }, { merge: true })
    res.redirect('/dashboard')
  } catch (err) {
    console.error(err)
    res.status(500).send('Erreur lors de la sauvegarde du profil.')
  }
})

app.use('/public', express.static('public'))