const projectsCollection = require('../../db').db().collection('projects');
const followsCollection = require('../../db').db().collection('follows');
const usersCollection = require('../../db').db().collection('users');
const ObjectID = require('mongodb').ObjectID;
const User = require('./userModel');
const sanitizeHTML = require('sanitize-html');

let Project = function (data, userid, requestedProjectId) {
  this.data = data;
  this.errors = [];
  this.userid = userid;
  this.requestedProjectId = requestedProjectId;
};

Project.prototype.cleanUp = function () {
  if (typeof this.data.title != 'string') {
    this.data.title = '';
  }
  if (typeof this.data.location != 'string') {
    this.data.location = '';
  }
  if (typeof this.data.bidSubmissionDeadline != 'string') {
    this.data.bidSubmissionDeadline = '';
  }
  if (typeof this.data.description != 'string') {
    this.data.description = '';
  }
  if (typeof this.data.email != 'string') {
    this.data.email = '';
  }
  if (typeof this.data.phone != 'string') {
    this.data.phone = '';
  }

  // GET RID OF BOGUS PROPERTIES
  this.data = {
    title: sanitizeHTML(this.data.title.trim(), { allowedTags: [], allowedAttributes: {} }),
    location: sanitizeHTML(this.data.location.trim(), { allowedTags: [], allowedAttributes: {} }),
    bidSubmissionDeadline: sanitizeHTML(this.data.bidSubmissionDeadline, { allowedTags: [], allowedAttributes: {} }),
    description: sanitizeHTML(this.data.description.trim(), { allowedTags: [], allowedAttributes: {} }),
    email: sanitizeHTML(this.data.email.trim(), { allowedTags: [], allowedAttributes: {} }),
    phone: this.data.phone,
    createdDate: new Date(),
    author: ObjectID(this.userid),
  };
};

Project.prototype.validate = function () {
  if (this.data.title == '') {
    this.errors.push('You must provide a title.');
  }
  if (this.data.location == '') {
    this.errors.push('You must provide a location.');
  }
  if (this.data.bidSubmissionDeadline == '') {
    this.errors.push('You must provide a date.');
  }
  if (this.data.description == '') {
    this.errors.push('You must provide a description.');
  }
  if (this.data.email == '') {
    this.errors.push('You must provide an email.');
  }
  if (this.data.phone == '') {
    this.errors.push('You must provide a phone.');
  }
};

Project.prototype.create = function () {
  return new Promise((resolve, reject) => {
    this.cleanUp();
    this.validate();

    if (!this.errors.length) {
      // save project into database
      projectsCollection
        .insertOne(this.data)
        .then(info => {
          resolve(info.ops[0]._id);
        })
        .catch(() => {
          this.errors.push('Please try again later.');
          reject(this.errors);
        });
    } else {
      reject(this.errors);
    }
  });
};

Project.prototype.update = function () {
  return new Promise(async (resolve, reject) => {
    try {
      let project = await Project.findSingleById(this.requestedProjectId, this.userid);
      if (project.isVisitorOwner) {
        // actually update the db
        let status = await this.actuallyUpdate();
        resolve(status);
      } else {
        reject();
      }
    } catch {
      reject();
    }
  });
};

Project.prototype.actuallyUpdate = function () {
  return new Promise(async (resolve, reject) => {
    this.cleanUp();
    this.validate();

    if (!this.errors.length) {
      await projectsCollection.findOneAndUpdate(
        { _id: new ObjectID(this.requestedProjectId) },
        {
          $set: {
            title: this.data.title,
            location: this.data.location,
            bidSubmissionDeadline: this.data.bidSubmissionDeadline,
            description: this.data.description,
            email: this.data.email,
            phone: this.data.phone,
            updatedDate: new Date(),
          },
        }
      );
      resolve('success');
    } else {
      resolve('failure');
    }
  });
};

Project.reusableProjectQuery = function (uniqueOperations, visitorId) {
  return new Promise(async function (resolve, reject) {
    let aggOperations = uniqueOperations.concat([
      { $lookup: { from: 'users', localField: 'author', foreignField: '_id', as: 'authorDocument' } },
      {
        $project: {
          title: 1,
          location: 1,
          bidSubmissionDeadline: 1,
          description: 1,
          email: 1,
          phone: 1,
          updatedDate: 1,
          _id: 1,
          firstName: 1,
          lastName: 1,
          createdDate: 1,
          bids: 1,
          authorId: '$author',
          author: { $arrayElemAt: ['$authorDocument', 0] },
        },
      },
    ]);

    let projects = await projectsCollection.aggregate(aggOperations).toArray();

    // clean up author property in each project object
    projects = projects.map(function (project) {
      project.isVisitorOwner = project.authorId.equals(visitorId);
      project.authorId = undefined;

      project.author = {
        _id: project.author._id,
        userCreationDate: new Date(ObjectID(project.author._id).getTimestamp()).toISOString().substring(0, 10),
        username: project.author.username,
        firstName: project.author.firstName,
        lastName: project.author.lastName,
        avatar: new User(project.author, true).avatar,
      };

      return project;
    });

    resolve(projects);
  });
};

Project.findSingleById = function (id, visitorId) {
  return new Promise(async function (resolve, reject) {
    if (typeof id != 'string' || !ObjectID.isValid(id)) {
      reject();
      return;
    }

    let projects = await Project.reusableProjectQuery([{ $match: { _id: new ObjectID(id) } }], visitorId);

    if (projects.length) {
      resolve(projects[0]);
    } else {
      reject();
    }
  });
};

Project.findByAuthorId = function (authorId) {
  return Project.reusableProjectQuery([{ $match: { author: authorId } }, { $sort: { createdDate: -1 } }]);
};

Project.delete = function (projectIdToDelete, currentUserId) {
  return new Promise(async (resolve, reject) => {
    try {
      let project = await Project.findSingleById(projectIdToDelete, currentUserId);
      if (project.isVisitorOwner) {
        await projectsCollection.deleteOne({ _id: new ObjectID(projectIdToDelete) });
        resolve();
      } else {
        reject();
      }
    } catch {
      reject();
    }
  });
};

Project.search = function (searchTerm) {
  return new Promise(async (resolve, reject) => {
    if (typeof searchTerm == 'string') {
      let projects = await Project.reusableProjectQuery([{ $match: { $text: { $search: searchTerm } } }, { $sort: { score: { $meta: 'textScore' } } }]);
      resolve(projects);
    } else {
      reject();
    }
  });
};

Project.countProjectsByAuthor = function (id) {
  return new Promise(async (resolve, reject) => {
    let projectCount = await projectsCollection.countDocuments({ author: id });
    resolve(projectCount);
  });
};

Project.getFeedWithoutLoggingIn = () => {
  return new Promise(async (resolve, reject) => {
    // GET ALL USER IDS
    let allUserIds = await usersCollection.distinct('_id');

    // GET ALL PROJECTS, IF ANY, THAT THE ABOVE IDS AUTHORED
    let allProjects = await Project.reusableProjectQuery([{ $match: { author: { $in: allUserIds } } }, { $sort: { createdDate: -1 } }]);

    resolve(allProjects);
  });
};

Project.getFeed = async function (id) {
  // create an array of the user ids that the current user follows
  let followedUsers = await followsCollection.find({ authorId: new ObjectID(id) }).toArray();

  followedUsers = followedUsers.map(function (followDoc) {
    return followDoc.followedId;
  });

  // look for projects where the author is in the above array of followed users
  return Project.reusableProjectQuery([{ $match: { author: { $in: followedUsers } } }, { $sort: { createdDate: -1 } }]);
};

Project.prototype.cleanUpBid = function () {
  if (typeof this.data.whatBestDescribesYou != 'string') {
    this.data.whatBestDescribesYou = '';
  }
  if (typeof this.data.yearsOfExperience != 'string') {
    this.data.yearsOfExperience = '';
  }
  if (typeof this.data.otherDetails != 'string') {
    this.data.otherDetails = '';
  }
  if (typeof this.data.phone != 'string') {
    this.data.phone = '';
  }

  // GET RID OF BOGUS PROPERTIES
  this.data = {
    projectId: ObjectID(this.data.projectId),
    ...(this.data.bidId && { bidId: this.data.bidId }),
    whatBestDescribesYou: sanitizeHTML(this.data.whatBestDescribesYou.trim(), { allowedTags: [], allowedAttributes: {} }),
    yearsOfExperience: sanitizeHTML(this.data.yearsOfExperience.trim(), { allowedTags: [], allowedAttributes: {} }),
    items: this.data.items,
    otherDetails: sanitizeHTML(this.data.otherDetails.trim(), { allowedTags: [], allowedAttributes: {} }),
    phone: sanitizeHTML(this.data.phone.trim(), { allowedTags: [], allowedAttributes: {} }),
    email: sanitizeHTML(this.data.email.trim(), { allowedTags: [], allowedAttributes: {} }),
    userCreationDate: this.data.userCreationDate,
    bidAuthor: this.data.bidAuthor,
  };
};

Project.prototype.validateBid = function () {
  if (this.data.whatBestDescribesYou == '') {
    this.errors.push('Please choose from the options.');
  }
  if (this.data.yearsOfExperience == '') {
    this.errors.push('Years of experience required.');
  }
  if (this.data.phone == '') {
    this.errors.push('Phone number is required.');
  }
  if (this.data.email == '') {
    this.errors.push('Email is required.');
  }
};

Project.prototype.addBid = function () {
  return new Promise(async (resolve, reject) => {
    this.validateBid();
    this.cleanUpBid();

    if (!this.errors.length) {
      await projectsCollection
        .findOneAndUpdate(
          { _id: new ObjectID(this.data.projectId) },
          {
            $push: {
              bids: {
                id: new ObjectID(),
                whatBestDescribesYou: this.data.whatBestDescribesYou,
                yearsOfExperience: this.data.yearsOfExperience,
                items: this.data.items,
                otherDetails: this.data.otherDetails,
                phone: this.data.phone,
                email: this.data.email,
                userCreationDate: this.data.userCreationDate,
                bidAuthor: this.data.bidAuthor,
                bidCreationDate: new Date(),
              },
            },
          },
          {
            projection: {
              _id: 0,
              bids: 1,
            },
            returnOriginal: false,
          }
        )
        .then(info => {
          resolve({ status: 'Success', bidId: info.value.bids[info.value.bids.length - 1].id });
        })
        .catch(() => {
          reject('Adding bid failed.');
        });
    } else {
      reject(this.errors);
    }
  });
};

Project.getSingleBid = data => {
  return new Promise((resolve, reject) => {
    projectsCollection
      .findOne(
        { _id: new ObjectID(data.projectId) },
        {
          projection: {
            title: 1,
            bids: 1,
            _id: 0,
          },
        }
      )
      .then(response => {
        const bid = response.bids.filter(bid => {
          return bid.id == data.bidId;
        })[0];
        resolve({ projectTitle: response.title, bid });
      })
      .catch(() => {
        reject('Getting bid failed. Please try again.');
      });
  });
};

Project.deleteBid = data => {
  return new Promise(async (resolve, reject) => {
    try {
      await projectsCollection.updateOne({ _id: new ObjectID(data.projectId) }, { $pull: { bids: { id: new ObjectID(data.bidId) } } });
      resolve('Success');
    } catch (error) {
      reject('Sorry, your bid was not deleted. Please try again.');
    }
  });
};

Project.prototype.saveEditedBid = function () {
  return new Promise((resolve, reject) => {
    // CLEAN UP DATA
    this.validateBid();
    this.cleanUpBid();

    if (!this.errors.length) {
      projectsCollection
        .findOneAndUpdate(
          { _id: new ObjectID(this.data.projectId) },
          {
            $set: {
              'bids.$[elem].id': new ObjectID(this.data.bidId),
              'bids.$[elem].whatBestDescribesYou': this.data.whatBestDescribesYou,
              'bids.$[elem].yearsOfExperience': this.data.yearsOfExperience,
              'bids.$[elem].items': this.data.items,
              'bids.$[elem].otherDetails': this.data.otherDetails,
              'bids.$[elem].phone': this.data.phone,
              'bids.$[elem].email': this.data.email,
              'bids.$[elem].userCreationDate': this.data.userCreationDate,
              'bids.$[elem].updatedDate': new Date(),
            },
          },
          {
            arrayFilters: [{ 'elem.id': new ObjectID(this.data.bidId) }],
          }
        )
        .then(_ => {
          resolve('Success');
        })
        .catch(error => {
          reject(error);
        });
    } else {
      reject(this.errors);
    }
  });
};

// EXPORT THIS FILE
module.exports = Project;
