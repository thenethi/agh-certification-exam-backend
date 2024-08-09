const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();

// Middleware

app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB");
});

// Define a schema for the registration details
const registrationSchema = new mongoose.Schema({
  fullName: String,
  email: String,
  mobileNumber: String,
  country: String,
  examType: String,
  state: String,
  city: String,
  transactionId: String,
});

const Registration = mongoose.model("Registration", registrationSchema);

// Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Nodemailer transport setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Route to create an order
app.post("/create-order", async (req, res) => {
  const { amount, currency, receipt } = req.body;
  const options = {
    amount: amount * 100, // amount in paise
    currency,
    receipt,
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to verify the payment
app.post("/verify-payment", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    registrationData,
  } = req.body;

  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const generatedSignature = hmac.digest("hex");

  if (generatedSignature === razorpay_signature) {
    try {
      // Save registration details with the transaction ID
      const newRegistration = new Registration({
        ...registrationData,
        transactionId: razorpay_payment_id,
      });

      await newRegistration.save();

      // Create email content based on the exam type
      const examDetails =
        registrationData.examType === "offline"
          ? `
          Exam Details:
          - Exam Type: ${
            registrationData.examType.charAt(0).toUpperCase() +
            registrationData.examType.slice(1)
          }
          - Country: ${registrationData.country}
          - State: ${registrationData.state}
          - City: ${registrationData.city}
        `
          : `
          Exam Type: ${
            registrationData.examType.charAt(0).toUpperCase() +
            registrationData.examType.slice(1)
          }
          - You will receive an email soon from our team with further details. Stay tuned!
        `;

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: registrationData.email,
        subject: "Exam Registration Confirmation",
        text: `
          Dear ${registrationData.fullName},

          We are pleased to inform you that your exam has been successfully scheduled. Thank you for your payment.

          ${examDetails}

          Your transaction ID is: ${razorpay_payment_id}.

          If you have any questions or need further assistance, please do not hesitate to contact us.

          Best regards,
          The Aptitude Guru Hem Team

          ---
          Please do not reply to this email. This is an automated message.
        `,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.log("Error sending email:", error);
        } else {
          console.log("Email sent:", info.response);
        }
      });

      res.json({
        message: "Payment verified and registration saved successfully!",
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to save registration details." });
    }
  } else {
    res.status(400).json({ error: "Invalid signature" });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
