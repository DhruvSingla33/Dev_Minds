require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const connectDB = require("./connectDB");
const Book = require("./models/Books");

const storage = require('./Cloudinary/index');

const fs = require('fs');
const csv = require('csv-parser');
const cors = require('cors');
const cosineSimilarity = require('ml-distance').similarity.cosine;

const Movie = require("./models/Movie");
const Message = require("./models/Message");
const Chat = require("./models/Chat");
const multer = require("multer");
const User = require("./userDetails");
const IssueRequest = require('./issuedetail'); 
const SuggestRequest = require('./suggestdetail'); 


const path = require('path');
const bcrypt = require("bcryptjs");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const nodemailer = require('nodemailer');
const sendgridTransport = require('nodemailer-sendgrid-transport');


const transporter = nodemailer.createTransport(sendgridTransport({
  auth: {
    api_key: process.env.SENDGRID_API_KEY
  }
}));

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const axios = require("axios");



const url = `https://devminds-h21q.onrender.com/`;
const url1='https://dev-minds-1.onrender.com/'
const interval = 30000;

function reloadWebsite() {
  axios
    .get(url)
    .then((response) => {
      console.log("website reloded");
    })
    .catch((error) => {
      console.error(`Error : ${error.message}`);
    });
}

setInterval(reloadWebsite, interval);

function reloadWebsite1() {
  axios
    .get(url)
    .then((response) => {
      console.log("website reloded");
    })
    .catch((error) => {
      console.error(`Error : ${error.message}`);
    });
}

setInterval(reloadWebsite1, interval);

const app = express();
app.set("view engine", "ejs");
const PORT = process.env.PORT || 5000;


connectDB();
app.use(cors());
app.use(express.urlencoded({ extended: true } ));
app.use(express.json());
app.use("/uploads", express.static("uploads"));



function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', data => results.push(data))
      .on('end', () => resolve(results))
      .on('error', err => reject(err));
  });
}

async function loadData() {
  const books = await readCSV('./Books.csv');
  const ratings = await readCSV('./Ratings.csv');

  const ratingsWithName = ratings.map(r => {
    const book = books.find(b => b.BookId === r.BookId);
    return book ? { ...r, book_title: book.book_title } : null;
  }).filter(Boolean);

  // Pivot table creation
  const pt = {};
  ratingsWithName.forEach(r => {
    const user = r.UserId;
    const title = r.book_title;
    const rating = parseFloat(r.Rating);
    if (!pt[title]) pt[title] = {};
    pt[title][user] = rating;
  });

  const bookTitles = Object.keys(pt);
  const users = [...new Set(ratingsWithName.map(r => r.UserId))];

  // Create matrix
  const matrix = bookTitles.map(title => {
    return users.map(user => pt[title][user] || 0);
  });
   console.log(matrix);
  return { books, bookTitles, users, matrix };
}




async function loadDataFromMongo() {
  const books = await Book.find({}, '_id title ratings').lean();

  const ratingsWithName = [];

  books.forEach(book => {
    book.ratings.forEach(r => {
     ratingsWithName.push({
        BookId: book._id.toString(),
        UserId: r.userId.toString(),
        Rating: r.rating,
        book_title: book.title
      });
    });
  });
  

    // Pivot table creation
  const pt = {};
  ratingsWithName.forEach(r => {
    const user = r.UserId;
    const title = r.book_title;
    const rating = parseFloat(r.Rating);
    if (!pt[title]) pt[title] = {};
    pt[title][user] = rating;
  });

  const bookTitles = Object.keys(pt);
  const users = [...new Set(ratingsWithName.map(r => r.UserId))];

  // Create matrix
  const matrix = bookTitles.map(title => {
    return users.map(user => pt[title][user] || 0);
  });
   console.log(matrix);
  return { books, bookTitles, users, matrix };
}
app.get('/recommend', async (req, res) => {
  const book_name = req.query.book_name;
  if (!book_name) return res.status(400).json({ error: "Missing book_name parameter" });

  try {
    const { books, bookTitles, matrix } = await loadData();
    const index = bookTitles.indexOf(book_name);
    if (index === -1) return res.status(404).json({ error: "Book not found" });

    const similarities = matrix.map((vec, i) => ({
      index: i,
      score: cosineSimilarity(matrix[index], vec)
    }));

    const top = similarities
      .sort((a, b) => b.score - a.score)
      .filter(s => s.index !== index)
      .slice(0, 4);

    const result = top.map(item => {
      const book = books.find(b => b.book_title === bookTitles[item.index]);
      return {
        title: book.book_title,
        author: book.book_author,
        book_id: book.BookId
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/recommend1', async (req, res) => {
  try {
    console.log("Content-based recommendation query");
    const book_name = req.query.book_name;
    if (!book_name) return res.status(400).json({ error: "Missing book_name parameter" });

    const books = await Book.find({});
    const titles = books.map(b => b.title.trim());
    const index = titles.indexOf(book_name);
  

    if (index === -1) return res.status(404).json({ error: "Book not found" });

   
    const vectors = titles.map(title => {
      const words = title.toLowerCase().split(' ');
      const freq = {};
      words.forEach(w => freq[w] = (freq[w] || 0) + 1);
      return freq;
    });

    const vocab = [...new Set(titles.flatMap(t => t.toLowerCase().split(/\s+/)))];
   
    function toVec(freq) {
      return vocab.map(word => freq[word] || 0);
    }

    const baseVec = toVec(vectors[index]);
    const similarities = vectors.map((vec, i) => ({
      index: i,
      score: cosineSimilarity(baseVec, toVec(vec))
    }));

    const top = similarities
      .sort((a, b) => b.score - a.score)
      .filter(s => s.index !== index)
      .slice(0, 10);

    const result = top.map(item => {
      const book = books[item.index];
      return {
        title: book.title,
        author: book.book_author,
        book_id: book._id,
        thumbnail: book.thumbnail,
        rating: book.book_rating,
      };
    });

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Content-Based recommend1
// app.get('/recommend1', async (req, res) => {
//   console.log("content baseed recommendation query");
//   const book_name = req.query.book_name;
//   if (!book_name) return res.status(400).json({ error: "Missing book_name parameter" });
//   console.log(book_name);
//  const books = await readCSV('./Books.csv');
//  console.log(books);
//   const titles = books.map(b => b.book_title);
//   const index = titles.indexOf(book_name);
//   if (index === -1) return res.status(404).json({ error: "Book not found" });

//   const vectors = titles.map(title => {
//     const words = title.toLowerCase().split(' ');
//     const freq = {};
//     words.forEach(w => freq[w] = (freq[w] || 0) + 1);
//     return freq;
//   });

//   const vocab = [...new Set(titles.flatMap(t => t.toLowerCase().split(' ')))];

//   function toVec(freq) {
//     return vocab.map(word => freq[word] || 0);
//   }

//   const baseVec = toVec(vectors[index]);
//   const similarities = vectors.map((vec, i) => ({
//     index: i,
//     score: cosineSimilarity(baseVec, toVec(vec))
//   }));

//   const top = similarities
//     .sort((a, b) => b.score - a.score)
//     .filter(s => s.index !== index)
//     .slice(0, 10);

//   const result = top.map(item => {
//     const book = books[item.index];
//     return {
//       title: book.book_title,
//       author: book.book_author,
//       book_id: book.BookId
//     };
//   });

//   res.json(result);
// });

// Hybrid
app.get('/hybrid_recommend', async (req, res) => {
  console.log("hybrid");
  const book_name = req.query.book_name;
  console.log(book_name);
  if (!book_name) return res.status(400).json({ error: "Missing book_name parameter" });

  try {
    // const { books, bookTitles, matrix } = await loadData();
     const { books, bookTitles, matrix } = await loadDataFromMongo();
     console.log(matrix);
     console.log(books);
    const index = bookTitles.indexOf(book_name);
    if (index === -1) return res.status(404).json({ error: "Book not found" });

    // Collaborative
    const similarities = matrix.map((vec, i) => ({
      index: i,
      score: cosineSimilarity(matrix[index], vec)
    }));
    const collab = similarities.filter(s => s.index !== index).slice(0, 5);
    console.log(collab );
    // Content-Based
  
     const titles = books.map(b => b.title);
     console.log(titles);
    const cbIndex = titles.indexOf(book_name);
    const cbVectors = titles.map(title => {
      const freq = {};
      title.toLowerCase().split(' ').forEach(w => freq[w] = (freq[w] || 0) + 1);
      return freq;
    });

    const vocab = [...new Set(titles.flatMap(t => t.toLowerCase().split(' ')))];
    const cbVec = vocab.map(word => cbVectors[cbIndex][word] || 0);
    const cbSimilarities = cbVectors.map((vec, i) => ({
      index: i,
      score: cosineSimilarity(cbVec, vocab.map(w => vec[w] || 0))
    }));
    const content = cbSimilarities.filter(s => s.index !== cbIndex).slice(0, 5);
     console.log(content);
    // Combine
    const scores = {};
    collab.forEach(({ index, score }) => {
      const title = bookTitles[index];
      scores[title] = (scores[title] || 0) + score * 0.6;
    });

    content.forEach(({ index, score }) => {
      const title = titles[index];
      scores[title] = (scores[title] || 0) + score * 0.4;
    });
   
    const final = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([title]) => {
        const book = books.find(b => b.title === title);
         return {
        title: book.title,
        author: book.book_author,
        book_id: book._id,
        thumbnail: book.thumbnail,
        rating: book.book_rating,
      };
      });
    console.log(final);
    res.json(final);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/movies", async (req, res) => {
  try {
    const category = req.query.category;
    
    const filter = {};
    if(category) {
      filter.category = category;
    }

    const data = await Movie.find(filter);
    if(!data) {
      throw new Error("Error occurred while fetching Movies");
    }
    res.status(201).json(data);

  } catch (error) {
    res.status(500).json({error: "Error occurred while fetching Movies"});
  }
})

app.post("/register", async (req, res) => {
  const { fname, lname, email, password, userType } = req.body;

  const encryptedPassword = await bcrypt.hash(password, 10);
  try {
    const oldUser = await User.findOne({ email });

    if (oldUser) {
      
      return res.json({ error: "User Exists" });
    }
    console.log(fname);
    await User.create({
      fname,
      lname,
      email,
      password: encryptedPassword,
      userType,
    });
    res.send({ status: "ok" });
  } catch (error) {
    res.send({ status: "error" });
  }
});
app.post("/login-user", async (req, res) => {
  console.log("login request");
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return res.json({ error: "User Not found" });
  }
  if (await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ email: user.email }, JWT_SECRET, {
      expiresIn: "45m",
    });

    if (res.status(201)) {
      return res.json({ status: "ok", data: token });
    } else {
      return res.json({ error: "error" });
    }
  }
  res.json({ status: "error", error: "InvAlid Password" });
});

app.post("/userData", async (req, res) => {
  const { token } = req.body;
  try {
    const user = jwt.verify(token, JWT_SECRET, (err, res) => {
      if (err) {
        return "token expired";
      }
      return res;
    });
    console.log(user);
    if (user == "token expired") {
      return res.send({ status: "error", data: "token expired" });
    }

    const useremail = user.email;
    User.findOne({ email: useremail })
      .then((data) => {
        res.send({ status: "ok", data: data });
      })
      .catch((error) => {
        res.send({ status: "error", data: error });
      });
  } catch (error) { }
});
app.get('/getdata', async (req, res) => {
  try {
    console.log("hi");

    
    const users = await User.find().populate("suggestBooks.bookId");

    if (!users || users.length === 0) {
      return res.status(404).json({ message: "No users found" });
    }

    const allUsersData = users.map(user => {
    
      const validSuggestedBooks = user.suggestBooks.filter(suggestBook => suggestBook.bookId !== null);

      return {
        userInfo: user,
        suggestBooks: validSuggestedBooks.map(suggestBook => ({
          ...suggestBook.bookId.toObject(),  
          status: suggestBook.status        
        }))
      };
    });

    console.log(allUsersData);
    return res.json({ status: "ok", data: allUsersData });

  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/getuserdata/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    console.log("Fetching user data...");

    const user = await User.findById(userId); // More concise than findOne({ _id: userId })

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

  
    const suggestBooks = user.suggestBooks || [];
    const bookIds = suggestBooks.map(s => s.bookId);

    
    const books = await Book.find({ _id: { $in: bookIds } });

 
    const booksWithStatus = suggestBooks
      .map(s => {
        const book = books.find(b => b._id.equals(s.bookId));
        if (!book) return null; 
        return {
          ...book.toObject(),
          status: s.status
        };
      })
      .filter(Boolean);

    const userData = {
      userInfo: user,
      suggestBooks: booksWithStatus,
    };

    console.log("User data fetched successfully", userData);
    return res.status(200).json({ status: "ok", data: userData });

  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


app.post("/api/chats/byuserid", async (req, res) => {
  const { userId } = req.body;
  try {
    const chats = await Chat.find({ users: userId })
      .populate("users", "fname email")
      .populate("latestMessage");

    res.json(chats);
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).send("Server error");
  }
});

// Add a comment to a book by slug
app.post("/api/books/:id/comments", async (req, res) => {
  // console.log("aati");
  // console.log(req);
  const { username, text } = req.body;

  try {
    const book = await Book.findById(req.params.id);


    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const newComment = {
      username,
      text,
      date: new Date(),
    };

    book.comments.push(newComment);
    console.log(book);
    await book.save();

    res.status(201).json({ message: "Comment added", book });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});



app.post('/getdata/:id', async (req, res) => {
  try {
    const userEmail = req.params.id;
    const emails=req.body.email;
    console.log(emails);
    console.log(userEmail );
    console.log("fite" );
    const user = await User.findOne({ email:emails });
    console.log(user);
    console.log("hi");

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
// console.log(user.issuedBooks);

// const books = [];
const issuedBooks=user.issuedBooks;
const bookIds = issuedBooks.map((issuedBook) => issuedBook.bookId);
    
    // Find books by the array of bookId values
    // console.log( bookIds);
    // console.log(issuedBooks);
    const books = await Book.find({ _id: { $in: bookIds } });
    // const bookIds = issuedBooks.map((issuedBook) => issuedBook.bookId);

    // // Find books by the array of bookId values
    // const books = await Book.find({ _id: { $in: bookIds } });
    
    // Merge status with corresponding books
    const booksWithStatus = issuedBooks.map((issuedBook) => {
      const matchingBook = books.find((book) => book._id.equals(issuedBook.bookId));
      return {
        ...matchingBook.toObject(), // Convert Mongoose document to plain object
        status: issuedBook.status,
      };
    });
    
    console.log(booksWithStatus);
    

// console.log(bookStatusMap);

    const userData = {
      userInfo: user,
      issuedBooks: booksWithStatus,
    };
    // const data=json(userData);
    console.log(userData);

    if (res.status(201)) {
      return res.json({ status: "ok", data: userData });
    } else {
      return res.json({ error: "error" });
    }
    
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
app.post("/issuebook", async (req, res) => {
  const { useremail, id } = req.body;

  try {
    const user = await User.findOne({ email: useremail });
    const book = await Book.findById(id);

    if (!user || !book) {
      return res.status(404).send({ status: "error", message: "User or book not found" });
    }

    // Add book to user's issuedBooks list
    user.issuedBooks.push({
      bookId: book._id,
      status: "Pending",
    });

    await user.save();

    // Create new issue request
    const newIssueRequest = new IssueRequest({
      userName: user.fname,
      bookName: book.title,
      userId: user._id,
      bookId: book._id,
      status: "Pending", // Optional: Add status if you have it in your schema
    });

    await newIssueRequest.save();

    console.log('Issue request saved:', newIssueRequest);

    res.send({ status: "ok", message: "Book issue request submitted successfully" });

  } catch (error) {
    console.error('Error in /issuebook route:', error);
    res.status(500).send({ status: "error", message: "Internal Server Error" });
  }
});

app.post("/suggestbook", async (req, res) => {
  const { useremail, id} = req.body;

  try {
    const user = await User.findOne({ email: useremail });
    const book = await Book.findById(id);
    if (!user || !book) {
      return res.status(404).send({ status: "error", message: "User or book not found" });
    }

    user.suggestBooks.push({
      bookId: book._id,
      status: "Pending",
    });

    await user.save();

    const newSuggestRequest = new SuggestRequest({
      userName: user.fname,
      bookName: book.title,
      userId: user._id,
      bookId: book._id,
    });

    await newSuggestRequest.save();

    console.log('Suggestion request saved:', newSuggestRequest);
    res.send({ status: "ok" });

  } catch (error) {
    console.error('Error in /suggestbook:', error);
    res.status(500).send({ status: "error", message: "Internal Server Error" });
  }
});



// Get all issue book data
app.get('/api/issue', async (req, res) => {
  
  try {
    const issueRequests = await IssueRequest.find();
    console.log(issueRequests);
    res.json(issueRequests);
  } catch (error) {
    console.error('Error fetching issue book data:', error);
    console.log('sjj');
    res.status(500).json({ message: 'Internal server error' });
  }
});


app.delete('/api/issue-requests/:id', async (req, res) => {
  try {
    const issueRequestId = req.params.id;
    await IssueRequest.findByIdAndDelete(issueRequestId);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting issue request:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
app.get('/api/issued/:id', async (req, res) => {
  try {
    const issueRequestId = req.params.id;
    const data = await IssueRequest.findById(issueRequestId).populate('userId').populate('bookId');

    if (!data) return res.status(404).send("Issue request not found");

    const user = data.userId;
    const book = data.bookId;

    // ✅ Construct dynamic email content
    const mailOptions = {
      from: 'singladhruv301@gmail.com', // Your verified SendGrid sender
      to: user.email, // Recipient's email
      subject: 'Book Issued - Please Collect It 📚',
      text: `Hi ${user.fname}, your book "${book.title}" is issued successfully. Please come and collect the book.`,
      html: `
        <h2>Book Issued Successfully</h2>
        <p>Hi <b>${user.fname}</b>,</p>
        <p>Your book <strong>"${book.title}"</strong> has been issued successfully.</p>
        <p>Please come and collect the book from the library.</p>
        <br />
        <p>– Book Hive Team</p>
      `
    };

    // ✅ Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
      } else {
        console.log("Email sent:", info.response);
      }
    });

    // ✅ Update status to "done"
    await User.findOneAndUpdate(
      { _id: user._id, 'issuedBooks.bookId': book._id },
      { $set: { 'issuedBooks.$.status': 'done' } },
      { new: true }
    );

    res.status(204).send();

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).send("Server error");
  }
});



app.post('/chat',async (req, res) => {
  const { userId ,user2Id} = req.body;
   console.log(userId);
   console.log(user2Id);
  if (!userId ||!user2Id) {
    console.log("UserId param not sent with request");
    return res.sendStatus(400);
  }

  // if (userId === user2Id) {
  //   return res.status(400).json({ message: "You cannot create a chat with yourself." });
  // }
  var isChat = await Chat.find({
    
    $and: [
      { users: { $elemMatch: { $eq: user2Id} } },
      { users: { $elemMatch: { $eq: userId } } },
    ],
  })
    .populate("users", "-password")
    .populate("latestMessage");



  if (isChat.length > 0) {
    res.send(isChat[0]);
  } else {
    var chatData = {
      
      users: [user2Id, userId],
    };

    try {
      const createdChat = await Chat.create(chatData);
      const FullChat = await Chat.findOne({ _id: createdChat._id }).populate(
        "users",
        "-password"
      );
      console.log(FullChat);
      res.status(200).json(FullChat);
    } catch (error) {
      res.status(400);
      throw new Error(error.message);
    }
  }
});

app.get("/api/books", async (req, res) => {
  try {
    const category = req.query.category;
    //const stars = req.query.stars;

    const filter = {};
    if(category) {
      filter.category = category;
    }

    const data = await Book.find(filter);
    
    if (!data) {
      throw new Error("An error occurred while fetching books.");
    }
    
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: "An error occurred while fetching books." });
  }
});


app.post("/api/books/:id/rate", async (req, res) => {
  try {
    const bookId = req.params.id;
    const { userId, rating } = req.body;

    const book = await Book.findById(bookId);

    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

  
    const alreadyRated = book.ratings.find((r) => r.userId.toString() === userId);

    if (alreadyRated) {
      
      return res.status(400).json({ error: "You have already rated this book." });
    }
     
     const newRow = `${bookId},${userId},${rating}\n`;

     // Path to CSV file
     const filePath = path.join(__dirname, 'Ratings.csv');
 
     // Append to CSV
     fs.appendFile(filePath, newRow, (err) => {
       if (err) {
         console.error('Error writing to CSV:', err);
       } else {
         console.log('Book added to CSV!');
       }
     });
 
    book.ratings.push({ userId, rating });
    book.book_rating += parseInt(rating);

    book.rating_count += 1;

    await book.save();
    console.log(book);
    res.json({ message: "Rating submitted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Something went wrong while submitting the rating." });
  }
});


app.post("/api/message", async(req,res)=>{
  const { content, chatId ,userId} = req.body;

  if (!content || !chatId) {
    console.log("Invalid data passed into request");
    return res.sendStatus(400);
  }

  var newMessage = {
    sender: userId,
    content: content,
    chat: chatId,
  };

  try {
    var message = await Message.create(newMessage);

    message = await message.populate("sender", "lname");
    message = await message.populate("chat");
   

    await Chat.findByIdAndUpdate(chatId, { latestMessage: message });
    console.log(message);
    res.json(message);
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
})

app.get("/api/message/:chatId", async (req, res) => {
  try {
    const messages = await Message.find({ chat: req.params.chatId })
      .populate("sender", "fname")
      .populate("chat");

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/api/books/:id", async (req, res) => {
  try {
    const bookId = req.params.id;
    const data = await Book.findById(bookId);

    if (!data) {
      return res.status(404).json({ error: "Book not found." });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred while fetching the book." });
  }
});



 // Multer config
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, 'uploads/');
//   },
//   filename: function (req, file, cb) {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, uniqueSuffix + "-" + file.originalname);
//   }
// });

const upload = multer({ storage });


// Route to create a book with thumbnail + PDF
app.post("/api/books", upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'pdf', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log(req.body);
    console.log(req.files);
    console.log(req.body.category);
    const thumbnailFile = req.files['thumbnail'] ? req.files['thumbnail'][0] : null;
    const pdfFile = req.files['pdf'] ? req.files['pdf'][0] : null;
    const newBook = new Book({
      title: req.body.title,
      book_author: req.body.book_author,
      description: req.body.description,
      category: req.body.category.split(',').map(item => item.trim()),
      thumbnail: thumbnailFile ? thumbnailFile.path : null, 
      pdf: pdfFile ? pdfFile.path : null,                  
      book_rating: 0,
      rating_count: 0,
    })
    console.log( newBook );
    await newBook.save();

    // // CSV Logging
    // const newRow = `${newBook._id},${newBook.book_author},${newBook.title}\n`;
    // const filePath = path.join(__dirname, 'Books.csv');

    // fs.appendFile(filePath, newRow, (err) => {
    //   if (err) {
    //     console.error('Error writing to CSV:', err);
    //   } else {
    //     console.log('Book added to CSV!');
    //   }
    // });

    res.json("Data Submitted");
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred while saving the book." });
  }
});




app.put("/api/books", upload.single("thumbnail"), async (req, res) => {
    try {
  
      const bookId = req.body.bookId;
  
      const updateBook = {
        title: req.body.title,
        slug: req.body.slug,
        stars: req.body.stars,
        description: req.body.description,
        category: req.body.category,
      }
  
      if (req.file) {
        updateBook.thumbnail = req.file.filename;
      }
  
      await Book.findByIdAndUpdate(bookId, updateBook)
      res.json("Data Submitted");
    } catch (error) {
      res.status(500).json({ error: "An error occurred while fetching books." });
    }
  });

 

  
 app.delete("/api/books/:id", async (req, res) => {
  const bookId = req.params.id;

  try {
    const result = await Book.deleteOne({ _id: bookId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Book not found." });
    }

    console.log("Book deleted");
    res.json({ message: "Book successfully deleted." });
  } catch (error) {
    console.error("Error deleting book:", error);
    res.status(500).json({ error: "Failed to delete book." });
  }
});













app.get("/", (req, res) => {
    res.json("This is the home page. For testing goto api/books OR api/animes");
});

app.get("*", (req, res) => {
    res.sendStatus("404");
});

const server=app.listen(PORT, () => {
    console.log(`Sever running at Port: ${PORT}`)
});

const io = require("socket.io")(server, {
  pingTimeout: 60000,
  cors: {
    origin: "http://localhost:5173", 
            
  },
});


io.on("connection", (socket) => {
  console.log("Connected to socket.io");
  socket.on("setup", (userData) => {
    socket.join(userData._id);
    socket.emit("connected");
  });

  socket.on("join chat", (room) => {
    socket.join(room);
    console.log("User Joined Room: " + room);
  });
  socket.on("typing", (room) => socket.in(room).emit("typing"));
  socket.on("stop typing", (room) => socket.in(room).emit("stop typing"));

  socket.on("new message", (newMessageRecieved) => {
    var chat = newMessageRecieved.chat;
    console.log("hello");
    console.log(chat);
    console.log("hello");
    if (!chat.users) return console.log("chat.users not defined");

    chat.users.forEach((user) => {
      if (user._id == newMessageRecieved.sender._id) return;

      socket.in(user._id).emit("message recieved", newMessageRecieved);
    });
  });

  socket.off("setup", () => {
    console.log("USER DISCONNECTED");
    socket.leave(userData._id);
  });
});






app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const oldUser = await User.findOne({ email });
    if (!oldUser) {
      return res.json({ status: "User Not Exists!!" });
    }
    const secret = JWT_SECRET + oldUser.password;
    const token = jwt.sign({ email: oldUser.email, id: oldUser._id }, secret, {
      expiresIn: "5m",
    });
    const link = `http://localhost:8000/reset-password/${oldUser._id}/${token}`;
    var transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "adarsh438tcsckandivali@gmail.com",
        pass: "rmdklolcsmswvyfw",
      },
    });

    var mailOptions = {
      from: "youremail@gmail.com",
      to: "thedebugarena@gmail.com",
      subject: "Password Reset",
      text: link,
    };

    transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
      }
    });
    console.log(link);
  } catch (error) { }
});

app.get("/reset-password/:id/:token", async (req, res) => {
  const { id, token } = req.params;
  console.log(req.params);
  const oldUser = await User.findOne({ _id: id });
  if (!oldUser) {
    return res.json({ status: "User Not Exists!!" });
  }
  const secret = JWT_SECRET + oldUser.password;
  try {
    const verify = jwt.verify(token, secret);
    res.render("index", { email: verify.email, status: "Not Verified" });
  } catch (error) {
    console.log(error);
    res.send("Not Verified");
  }
});

app.post("/reset-password/:id/:token", async (req, res) => {
  const { id, token } = req.params;
  const { password } = req.body;

  const oldUser = await User.findOne({ _id: id });
  if (!oldUser) {
    return res.json({ status: "User Not Exists!!" });
  }
  const secret = JWT_SECRET + oldUser.password;
  try {
    const verify = jwt.verify(token, secret);
    const encryptedPassword = await bcrypt.hash(password, 10);
    await User.updateOne(
      {
        _id: id,
      },
      {
        $set: {
          password: encryptedPassword,
        },
      }
    );

    res.render("index", { email: verify.email, status: "verified" });
  } catch (error) {
    console.log(error);
    res.json({ status: "Something Went Wrong" });
  }
});

app.get("/getAllUser", async (req, res) => {
  try {
    console.log("hi");
    const allUser = await User.find({});
    res.send({ status: "ok", data: allUser });
  } catch (error) {
    console.log("hII");
    console.log(error);
  }
});

app.post("/deleteUser", async (req, res) => {
  const { userid } = req.body;
  try {
    User.deleteOne({ _id: userid }, function (err, res) {
      console.log(err);
    });
    res.send({ status: "Ok", data: "Deleted" });
  } catch (error) {
    console.log(error);
  }
});


app.post("/upload-image", async (req, res) => {
  const { base64 } = req.body;
  try {
    await Images.create({ image: base64 });
    res.send({ Status: "ok" })

  } catch (error) {
    res.send({ Status: "error", data: error });

  }
})

app.get("/get-image", async (req, res) => {
  try {
    await Images.find({}).then(data => {
      res.send({ status: "ok", data: data })
    })

  } catch (error) {

  }
})

app.get("/paginatedUsers", async (req, res) => {
  const allUser = await User.find({});
  const page = parseInt(req.query.page)
  const limit = parseInt(req.query.limit)

  const startIndex = (page - 1) * limit
  const lastIndex = (page) * limit

  const results = {}
  results.totalUser=allUser.length;
  results.pageCount=Math.ceil(allUser.length/limit);

  if (lastIndex < allUser.length) {
    results.next = {
      page: page + 1,
    }
  }
  if (startIndex > 0) {
    results.prev = {
      page: page - 1,
    }
  }
  results.result = allUser.slice(startIndex, lastIndex);
  res.json(results)
})