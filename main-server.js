// Main server file for the application
// This file sets up the Express server and defines the routes for the application.


const express = require("express");
const app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
    res.render("index");
});

app.listen(3000);
