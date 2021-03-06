var db = require("../models");
var passport = require("../config/passport");
var isAuthenticated = require("../config/middleware/isAuthenticated");
var op = db.sequelize.Op

//These dependencies will allow users to upload files to cloudinary storage
var multer = require("multer");
var cloudinary = require("cloudinary");
cloudinary.config(process.env.CLOUDINARY_URL);
var cloudinaryStorage = require("multer-storage-cloudinary");

//moment will be used for deciding which rows from the table to serve given the current date
var moment = require("moment");
var currentYear = parseInt(moment().format("YYYY"))

//Configuring the way files will be uploaded to coludinary as well as limiting the types of files
var storage = cloudinaryStorage({
  cloudinary: cloudinary,
  folder: "pad_notes",
  allowedFormats: ["jpg", "png", "pdf"],
  transformation: [{ width: 500, height: 500, crop: "limit", format: "jpg" }]
});
var parser = multer({ storage: storage });

module.exports = function (app) {


  //These Routes handle user sign in/log ins
  // Route to handle login attempts. Using passport's local authentication strategy
  // user will be served content based on wether the authentication was successful or not
  app.post("/user/login", passport.authenticate("local"), function (req, res) {
    //after the user is logged in, ifthey have a group they will be redirected to their home,
    //if they don't have a group, they will be redirected to page where they can make a group 
    //or request to join an existing one 
    if (req.user.GroupId) {
      res.json("home");
    }
    else {
      res.json("groupJoin")
    }
  });

  //route for handling new user account creation requests. It will use the requirements and methods 
  //given in the user.js model to attempt to insert a new user record into the Users table of the database
  //if the user account is succesfully created, then the user will automatically be loged in via the 'user/login/' route
  app.post("/new-user/signup", function (req, res) {
    db.User.create({
      email: req.body.email,
      password: req.body.password,
      name: req.body.name
    })
      //after succesfully creating the row for the new user, they will be redierected through the user/login route with their credentials
      .then(function () {
        res.redirect(307, "/user/login")
      }).catch(function (error) {
        res.json(error);
      })
  })
  //this route should be hit after a user creates or joins a group. They will be given a group id from the group they created/
  //joined
  app.put("/user", function (req, res) {
    db.User.update(req.body,
      {
        where: {
          id: req.user.id
        }
      }).then(function (data) {
        //updating the session user GroupId
        req.user.GroupId = req.body.GroupId;
        //redirecting the user to their home page
        return res.status(200).send({ result: 'redirect', url: '/home' })
      })

  })

  // Route for logging user out
  app.get("/logout", function (req, res) {
    req.logout();
    res.redirect("/");
  });

  //These routes handle messages
  //this route will return all messages for a user
  app.get("/messages", isAuthenticated, function (req, res) {
    var hdbsObj = {
      messages: "",
      users: ""
    }
    db.Message.findAll({
      where: {
        recepientId: req.user.id
      }
    }).then(function (messageData) {
      hdbsObj.messages = messageData
    })
    db.User.findAll({
      attributes: ['name'],
    }).then(function (userData) {
      hdbsObj.users = userData
      res.render("messages", hdbsObj);
    });
  })
  //this route allows for new messages to be created
  app.post("/messages", isAuthenticated, function (req, res) {
    db.Message.create({
      subject: req.body.subject,
      body: req.body.body,
      type: req.body.type,
      senderName: req.user.name,
      senderId: req.user.id,
      recepientId: req.body.recepientId
    }).then(function (data) {
      res.end();
    })
  })
  //this route allows users to delete messages
  app.delete("/message/delete/:id", isAuthenticated, function (req, res) {
    db.Message.destroy({
      where: {
        id: req.params.id
      }
    }).then(function () {
      res.end()
    })
  })

  //These routes handle group managment
  //this route will return groups who's names are similar to the passed group name
  app.get("/groups/:groupName", isAuthenticated, function (req, res) {
    db.Group.findAll({
      where: {
        groupName: {
          [op.like]: '%' + req.params.groupName + '%'
        }
      }
    }).then(function (groupData) {
      res.json(groupData)
    })
  })
  //this route will return all groups
  app.get("/groups/", isAuthenticated, function (req, res) {
    db.Group.findAll({})
      .then(function (groupData) {
        res.json(groupData)
      })
  })
  //the route for creating new groups. It will get a groupName from the client, and then assign the 
  //id of the user who created the group to the new entry. It will send the data for the new group back to the client
  app.post("/groups/create", function (req, res) {
    db.Group.create({
      groupName: req.body.groupName,
      creatorId: req.user.id
    })
      .then(function (data) {
        res.send(data);
      })
      .catch(function (error) {
        res.json(error);
      })
  });
  //this route provides the user the ability to accept join requests in their messages
  app.put("/request/join/accept", isAuthenticated, function (req, res) {
    //first we find the message that triggered the route
    db.Message.findOne({
      where: {
        id: req.body.id
      }
    }).then(function (messageData) {
      //just to make sure, check to see that the user's id is the same as the message's recepeint id
      if (req.user.id === messageData.recepientId) {
        //update the groupId of the user who sent the join request
        db.User.update({
          GroupId: req.user.GroupId
        }, {
            where: {
              id: messageData.senderId
            }
          }).then(function (userData) {
            res.end();
          });
      }
    })
  })


  //-----------BILLS---------------------------------------------------------------
  //these routes handle bills 

  //this route allows users to add a new bill
  app.post("/bill/add", isAuthenticated, parser.single("image"), function (req, res) {
    //this parses the cloudinary file url into a thumbnail for the document
    if (req.file == undefined) {
      var originalUrl = "";
      var makeThumbUrl = "";
    }
    else {
      var originalUrl = req.file.url
      var makeThumbUrl = originalUrl.slice(0, (originalUrl.indexOf("upload/") + 7)) + "w_200,h_250,bo_1px_solid_black/" + originalUrl.slice((originalUrl.indexOf("upload/") + 7), -3) + "jpg";
    }

    // Bill CREATE----------------
    db.Bill.create({
      billName: req.body.billName,
      amount: req.body.amount,
      complete: false,
      UserId: req.user.id,
      GroupId: req.user.GroupId,
      fileUrl: originalUrl,
      thumbUrl: makeThumbUrl,
      month: req.body.month,
      year: currentYear
    }).then(function (data) {
      res.redirect("/home");
    })
  })

  // Bill UPDATE----------------
  app.put("/bill/edit/:creatorId/:billId", isAuthenticated, function (req, res) {
    var creatorId = parseInt(req.params.creatorId);
    var billId = parseInt(req.params.billId);
    if (req.user.id === creatorId) {
      db.Bill.update({
        billName: req.body.billName,
        amount: req.body.amount,
        month: req.body.month

      },{
        where:{
          id: billId
        }
      }).then(function(data){
        db.Bill.findOne({
          where: {
            id: billId
          }
        }).then(function(updatedBillData){
          res.json(updatedBillData);
        });
      });
    };
  });

  // Bill DELETE----------------
  app.delete("/bill/delete/:billId", isAuthenticated, function (req, res) {
    db.Bill.destroy({
      where: {
        id: req.params.billId
      }
    }).then(function (data) {
      res.end();
    });
  });


  //-----------GROCERY---------------------------------------------------------------

  app.post("/grocery/add", isAuthenticated, function (req, res) {
    db.Grocery.create({
      groceryName: req.body.groceryName,
      quantity: req.body.quantity,
      complete: false,
      UserId: req.user.id,
      GroupId: req.user.GroupId
    }).then(function (data) {
      res.end();
    })
  })

  //grocery update
  app.put("/grocery/edit/:creatorId/:groceryId", isAuthenticated, function (req, res) {
    var creatorId = parseInt(req.params.creatorId);
    var groceryId = parseInt(req.params.groceryId);
   
      db.Grocery.update({
        groceryName: req.body.groceryName,
        quantity: req.body.quantity
      },{
        where:{
          id: groceryId
        }
      }).then(function(data) {
        db.Grocery.findOne({
          where: {
            id: groceryId
          }
        }).then(function(updatedGroceryData) {
          console.log("done updating grocery")
          console.log(data);
          res.json(updatedGroceryData);
        })
      });
    
  });
  app.delete("/grocery/delete/:groceryId", isAuthenticated, function (req, res) {
    db.Grocery.destroy({
      where: {
        id: req.params.groceryId
      }
    }).then(function (data) {
      res.end();
    });
  });


  //-----------CHORE---------------------------------------------------------------
  //Chore CREATE

  app.post("/chore/add", isAuthenticated, function (req, res) {
    db.Chore.create({
      chore: req.body.chore,
      complete: false,
      recurDate: req.body.recurDate,
      UserId: req.user.id,
      GroupId: req.user.GroupId
    }).then(function (data) {
      res.end();
    })
  })


  //Chore UPDATE
  app.put("/chore/edit/:creatorId/:choreId", isAuthenticated, function (req, res) {
    var choreId = parseInt(req.params.choreId);
    var creatorId = parseInt(req.params.creatorId);
    if (req.user.id === creatorId) {
      db.Chore.update({
        chore: req.body.chore,
        recurDate: req.body.recurDate,
        complete: req.body.complete
      },{
        where:{
          id: choreId
        }
      }).then(function(data){
        db.Chore.update({
          complete: false
        },{
          where: {
            recurDate:{
              [op.ne]: moment().format("ddd")
            }
          
          }
        }).then(function(data){
          db.Chore.findOne({
            where: {
              id: choreId
            }
          }).then(function(updatedChore){
            res.json(updatedChore);
          })
        });
      })

    }

  });


  //Chore DELETE 
  app.delete("/chore/delete/:choreId", isAuthenticated, function (req, res) {
    db.Chore.destroy({
      where: {
        id: req.params.choreId
      }
    }).then(function (data) {
      res.end();
    });
  });

};
