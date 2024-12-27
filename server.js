const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();
const twilio = require('twilio');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// MySQL Database Connection
const db = mysql.createPool({
  connectionLimit: 10,  // Pool size: max number of connections
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DBNAME
});

const accountSid = process.env.SID; // Replace with your Twilio Account SID
const authToken = process.env.AUTHTOKEN;   // Replace with your Twilio Auth Token
const client = twilio(accountSid, authToken);

db.on('connect', () => {
  console.log('Database connected successfully!');
});

// Handling connection error (e.g., connection lost)
db.on('error', (err) => {
  console.error('MySQL error: ', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    console.log('Connection lost, reconnecting...');
    db.getConnection((err, connection) => {
      if (err) {
        console.error('Error reconnecting: ', err);
        return;
      }
      console.log('Reconnected to MySQL');
      connection.release(); // Release the connection back to the pool
    });
  } else {
    console.error('Unexpected MySQL error: ', err);
  }
});

db.query("SET time_zone = '+05:30'", (err) => {
  if (err) {
    console.error("Error setting time zone:", err);
  }
  else {
    console.log("Time zone set +05:30");
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Default route to serve the index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//login and register 

app.post('/login', [
  // Validate input fields
  body('email').isEmail().withMessage('Please enter a valid email address'),
  body('password').notEmpty().withMessage('Password cannot be empty'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  // Query to check if email exists
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'User not found, Register first then login.' });

    // Compare the password with the hash stored in the database
    const user = results[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!isMatch) return res.status(400).json({ message: 'Invalid credentials, please enter valid credentials' });

      

      // Return success and user info
      res.status(200).json({
        message: 'Login successful',
        user: { id: user.id, email: user.email},
        companyId: user.company_id
      });
    });
  });
});

// Create Account route
app.post('/create-account', [
  // Validate and sanitize input fields
  body('name').notEmpty().withMessage('Name is required'),
  body('company_id').notEmpty().withMessage('Company ID is required'),
  body('email').isEmail().withMessage('Please enter a valid email address'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirm_password').custom((value, { req }) => value === req.body.password).withMessage('Passwords must match'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log(errors);
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, company_id, email, password, mobile_number } = req.body;

  // Check if email already exists in the database
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) return res.status(400).json({ message: 'Email already exists' });

    // Hash the password before saving it
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: err.message });
      }

      // Insert new user into the database
      const newUser = {
        name,
        company_id,
        email,
        mobile_number,
        password: hashedPassword,
      };

      db.query('INSERT INTO users SET ?', newUser, (err, results) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ error: err.message });
        }

        res.status(201).json({
          message: 'Account created successfully',
          user: { id: results.insertId, email }
        });
      });
    });
  });
});

// dashboard

//user details

// Route to fetch user details by companyId
app.get('/user/:companyId', (req, res) => {
  const { companyId } = req.params;

  // Query to fetch user data based on company_id
  db.query('SELECT * FROM users WHERE company_id = ?', [companyId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length === 0) return res.status(404).json({ message: 'User not found' });

    const user = results[0];

    // Return the user details
    res.status(200).json({
      name: user.name,
      mobile: user.mobile_number,
      company_id: user.company_id,
      email: user.email
    });
  });
});



// dashboard cards
const dashboard_card_query = {
  totalMolds: 'SELECT COUNT(*) AS totalMolds FROM mold',
  dailyProduction: `
      SELECT SUM(
        COALESCE(production_cnt, 0)
      ) AS dailyProduction
      FROM mold_data_entry
      WHERE DATE(date_time) = CURDATE()
    `,
  activeMolds: "SELECT COUNT(*) AS activeMolds FROM mold WHERE status = 'Active'",
};

app.get('/api/dashboard-data', (req, res) => {
  const results = {};
  db.query(dashboard_card_query.totalMolds, (err, totalMoldsResult) => {
    if (err) {
      console.error('Error fetching total molds:', err);
      return res.status(500).json({ error: 'Error fetching total molds' });
    }
    results.totalMolds = totalMoldsResult[0].totalMolds;

    db.query(dashboard_card_query.dailyProduction, (err, dailyProductionResult) => {
      if (err) {
        console.error('Error fetching daily production:', err);
        return res.status(500).json({ error: 'Error fetching daily production' });
      }
      results.dailyProduction = dailyProductionResult[0].dailyProduction;

      db.query(dashboard_card_query.activeMolds, (err, activeMoldsResult) => {
        if (err) {
          console.error('Error fetching active molds:', err);
          return res.status(500).json({ error: 'Error fetching active molds' });
        }
        results.activeMolds = activeMoldsResult[0].activeMolds;

        // Send the final response
        res.json(results);
      });
    });
  });
});

// New query for fetching weekly production data
const dashboard_weekly_stat_query = {
  weeklyProduction: `
      SELECT 
        DATE(date_time) AS productionDate,
        SUM(
          COALESCE(production_cnt, 0)
        ) AS productionUnits
      FROM mold_data_entry
      WHERE date_time >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(date_time)
      ORDER BY productionDate ASC
    `
};

app.get('/api/weekly-production', (req, res) => {
  db.query(dashboard_weekly_stat_query.weeklyProduction, (err, result) => {
    if (err) {
      console.error('Error fetching weekly production:', err);
      return res.status(500).json({ error: 'Error fetching weekly production' });
    }
    res.json(result);
  });
});


// Endpoint to Save Alert Details
app.post('/api/set-alert', (req, res) => {
  const { moldNumber, productionLimit, email, mobile } = req.body;

  const query = `
        INSERT INTO alerts (moldNumber, productionLimit, email, mobileNo ,date_time)
        VALUES (?, ?, ?, ?, CONVERT_TZ(NOW(), '+00:00', '+05:30'))
    `;

  db.query(query, [moldNumber, productionLimit, email, mobile], (err, result) => {
    if (err) {
      console.error('Error inserting alert:', err);
      return res.status(500).json({ error: 'Error setting alert , Mould Number not found !' });
    }
    res.json({ message: 'Alert set successfully' });
  });
});

let isProcessing = false;

setInterval(() => {
  if (isProcessing) return;  // Skip execution if already processing

  isProcessing = true;

  const checkQuery = `
        SELECT a.id, a.moldNumber, a.productionLimit, a.email, a.mobileNo, 
               SUM(COALESCE(production_cnt, 0)) AS totalProduction
        FROM alerts a
        JOIN mold_data_entry m ON a.moldNumber = m.mold_number
        GROUP BY a.id, a.moldNumber, a.productionLimit, a.email
        HAVING totalProduction >= a.productionLimit
    `;

  db.query(checkQuery, (err, results) => {
    if (err) {
      console.error('Error checking alerts:', err);
      isProcessing = false;  // Reset flag if error occurs
      return;
    }

    results.forEach(alert => {
      const { id, moldNumber, email, productionLimit, mobileNo } = alert;


      // Add Notification with the fixed timestamp
      const notificationQuery = `
                INSERT INTO notifications (moldNumber, notification_type, message, date_time)
                VALUES (?,"limitAlert", ?, CONVERT_TZ(NOW(), '+00:00', '+05:30'))
            `;
      const message = `Production limit exceeded for Mould No.: ${moldNumber}. Limit set: ${productionLimit}`;

      db.query(notificationQuery, [moldNumber, message], (err) => {
        if (err) {
          console.error('Error adding notification:', err);
          isProcessing = false;
          return;
        }

        console.log('Notification added for Mold:', moldNumber);

        // Send Email with the same timestamp message
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: 'stunnel909@gmail.com',
            pass: 'bwfa ghcs hvaf vusi'
          }
        });

        const mailOptions = {
          from: 'stunnel909@gmail.com',
          to: email,
          subject: 'Production Alert',
          text: message
        };

        transporter.sendMail(mailOptions, (err) => {
          if (err) {
            console.error('Error sending email:', err);
            isProcessing = false;
            return;
          }

          console.log('Email sent to:', email);
          sendSMS(mobileNo, message);

          // Delete Alert after sending the email
          const deleteQuery = `DELETE FROM alerts WHERE id = ?`;
          db.query(deleteQuery, [id], (err) => {
            if (err) {
              console.error('Error deleting alert:', err);
            } else {
              console.log('Alert deleted for Mold:', moldNumber);
            }
          });
        });
      });
    });

    isProcessing = false;  // Reset the flag after processing is done
  });
}, 60000); // Check every 30 seconds

function sendSMS(to, message) {
  const from = '+18144262249'; // Replace with your Twilio phone number
  client.messages
    .create({
      body: message, // Message to send
      from: from,    // Your Twilio phone number
      to: to         // Recipient's phone number
    })
    .then(message => console.log(`Message sent successfully!`))
    .catch(error => console.error('Error sending SMS:', error));
}

// Periodic process (runs every minute)
setInterval(() => {
  console.log("Running periodic mould check...");

  // Query to calculate production_cnt dynamically for active molds only
  const checkProductionQuery = `
      SELECT 
          m.id AS mold_id, 
          m.moldNo, 
          m.lifespan, 
          m.maintainanceAlert, 
          m.status,
          m.notificationStatus,
          m.maintainanceAlertCurrentStatus,
          m.perMaintenanceAlert,
          SUM( 
              COALESCE(md.production_cnt, 0)) AS production_cnt
      FROM mold m
      LEFT JOIN mold_data_entry md ON m.moldNo = md.mold_number
      WHERE m.status = 'Active'  -- Only process active molds
      GROUP BY m.id, m.moldNo, m.lifespan, m.maintainanceAlert, m.status
    `;

  db.query(checkProductionQuery, (err, molds) => {
    if (err) {
      console.error("Error fetching molds:", err);
      return;
    }

    // Process each active mold
    molds.forEach((mold) => {
      const { mold_id, moldNo, lifespan, maintainanceAlert, production_cnt } = mold;

      //const mobileNo=['+919579029553','+919307595421'];

      // Check if mold is expired



      if (production_cnt >= lifespan) {
        const newStatus = "Inactive";
        const message = `Mould No. ${moldNo} has expired. Production count (${production_cnt} Units) has exceeded its lifespan (${lifespan} Units). Status has been changed to '${newStatus}'.`;
        updateMoldStatus(mold_id, newStatus, () => {
          addNotification(moldNo, "expiration", message);
          console.log('SMS send on', mobileNo);
          mobileNo.forEach((no)=>{
          sendSMS(no, message)});
        });
      }

      else if (production_cnt >= lifespan - (lifespan * 0.3) && mold.notificationStatus === "NA") {
        const newStatus = "Send";
        const message = `Mould No. ${moldNo} is nearing expiration. Its production count (${production_cnt} units) has surpassed its lifespan limit of ${lifespan} units.`;
        updateMoldNotification(mold_id, newStatus, () => {
          addNotification(moldNo, "expiration_soon", message);
          console.log('SMS send on', mobileNo);
          mobileNo.forEach((no)=>{
            sendSMS(no, message)});
        });
      }
      // Check if maintenance is required
      else if (production_cnt >= mold.maintainanceAlertCurrentStatus) {
        const newStatus = "Under Maintenance";
        const newMaintainanceCnt = mold.maintainanceAlertCurrentStatus + maintainanceAlert
        const message = `Mould No. ${moldNo} requires maintenance. Production count (${production_cnt} Units) has exceeded the maintenance alert (${maintainanceAlert} Units). Status has been changed to '${newStatus}'. Next maintenance is after ${mold.maintainanceAlertCurrentStatus + maintainanceAlert} Production Units`;
        updateMoldStatusAndcnt(mold_id, newMaintainanceCnt, newStatus, () => {
          addNotification(moldNo, "maintenance", message);
          console.log('SMS send on', mobileNo);
          mobileNo.forEach((no)=>{
            sendSMS(no, message)});
        });
      }

      else if (production_cnt >= mold.maintainanceAlertCurrentStatus - (mold.maintainanceAlertCurrentStatus * 0.1) && mold.perMaintenanceAlert === "NA") {
        const newStatus = "Near Maintenance";
        const newMaintainanceCnt = 0;
        const message = `Mould No. ${moldNo} is nearing maintenance. Production count (${production_cnt} Units) is approaching the maintenance alert threshold (${maintainanceAlert} Units).`;
        updateMoldStatusAndcnt(mold_id, newMaintainanceCnt, newStatus, () => {
          addNotification(moldNo, "near_maintenance", message);
          console.log('SMS send on', mobileNo);
          mobileNo.forEach((no)=>{
            sendSMS(no, message)});
        });
      }
    });
  });
}, 60000); // Runs every 60 seconds

/**
 * Update the status of a mold in the mold table
 * @param {number} moldId - The ID of the mold
 * @param {string} newStatus - The new status (e.g., 'Inactive', 'Under Maintenance')
 * @param {Function} callback - Callback function to execute after the status is updated
 */
function updateMoldStatus(moldId, newStatus, callback) {
  const updateStatusQuery = `
      UPDATE mold 
      SET status = ? 
      WHERE id = ?
    `;

  db.query(updateStatusQuery, [newStatus, moldId], (err) => {
    if (err) {
      console.error(`Error updating mold status for Mold ID ${moldId}:`, err);
      return;
    }
    console.log(`Mold ID ${moldId} status updated to: ${newStatus}`);
    if (callback) callback(); // Execute the callback after status update
  });
}

function updateMoldStatusAndcnt(moldId, newMaintainanceCnt, newStatus, callback) {
  console.log(newMaintainanceCnt);
  if (newStatus === "Under Maintenance") {
    const updateStatusandcntQuery = `
      UPDATE mold 
      SET status = ? , maintainanceAlertCurrentStatus= ? ,perMaintenanceAlert ="NA"
      WHERE id = ?
    `;

    db.query(updateStatusandcntQuery, [newStatus, newMaintainanceCnt, moldId], (err) => {
      if (err) {
        console.error(`Error updating mold status for Mold ID ${moldId}:`, err);
        return;
      }
      console.log(`Mould No. ${moldId} status updated to: ${newStatus}`);
      if (callback) callback(); // Execute the callback after status update
    });
  }
  else if (newStatus === "Near Maintenance") {
    const updateStatusandcntQuery = `
    UPDATE mold 
    SET perMaintenanceAlert = ? 
    WHERE id = ?
  `;

    db.query(updateStatusandcntQuery, [newStatus, moldId], (err) => {
      if (err) {
        console.error(`Error updating Pre mold status for Mold ID ${moldId}:`, err);
        return;
      }
      console.log(`Mould No. ${moldId} Pre maintanance alert.`);
      if (callback) callback(); // Execute the callback after status update
    });
  }
}

function updateMoldNotification(moldId, newNotificationStatus, callback) {
  const updateMoldNotificationQuery = `
      UPDATE mold 
      SET notificationStatus = ? 
      WHERE id = ?
    `;

  db.query(updateMoldNotificationQuery, [newNotificationStatus, moldId], (err) => {
    if (err) {
      console.error(`Error updating mold notification status for Mold ID ${moldId}:`, err);
      return;
    }
    console.log(`Mold ID ${moldId} Notification Status updated to: ${newNotificationStatus}`);
    if (callback) callback(); // Execute the callback after status update
  });
}

/**
 * Add a notification to the notifications table
 * @param {number} moldId - The ID of the mold
 * @param {string} type - Notification type (e.g., 'expiration', 'maintenance')
 * @param {string} message - Notification message
 */
function addNotification(moldNo, type, message) {
  // Format as 'YYYY-MM-DD HH:MM:SS'
  const insertNotificationQuery = `
      INSERT INTO notifications (moldNumber, notification_type, message, date_time)
      VALUES (?, ?, ?, CONVERT_TZ(NOW(), '+00:00', '+05:30'))
    `;

  db.query(insertNotificationQuery, [moldNo, type, message], (err) => {
    if (err) {
      console.error("Error adding notification:", err);
      return;
    }
    console.log(`Notification added: Mould No. ${moldNo}, Type ${type}`);
  });
}



// update notification
app.get('/api/notifications', (req, res) => {
  const query = 'SELECT * FROM notifications ORDER BY id DESC'; // Adjust query as needed
  db.query(query, (err, result) => {
    if (err) {
      console.error('Error fetching notifications:', err);
      return res.status(500).json({ error: 'Error fetching notifications' });
    }
    res.json(result);
  });
});

// Route to Add Data to the Mold Table
app.post('/api/molds', (req, res) => {
  const {
    mouldType, mouldNo, date, lifespan, status,
    maintainanceAlert, mouldManufacturerName, manufacturerContact,
    mouldAddedBy, remark
  } = req.body;


  const query = `
        INSERT INTO mold (
            moldType, moldNo, date, lifespan, status,
            maintainanceAlert,maintainanceAlertCurrentStatus, moldManufacturerName, manufacturerContact,
            moldAddedBy, remark
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

  const values = [
    mouldType, mouldNo, date, lifespan, status,
    maintainanceAlert, maintainanceAlert, mouldManufacturerName, manufacturerContact,
    mouldAddedBy, remark
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error('Failed to insert data: ', err);
      return res.status(500).json({ error: 'Error adding data , Mould is allready present' });
    } else {
      res.status(200).send('Mould details added successfully');
    }
  });
});

// Fetch mold details
app.get('/api/getmolds', (req, res) => {
  const statusFilter = req.query.status || 'all';  // Default to 'all' if no status is provided
  let query = 'SELECT * FROM mold';  // Base query

  // Add a WHERE clause if a specific status is provided (other than 'all')
  if (statusFilter !== 'all') {
    query += ` WHERE status = ?`;  // Use parameterized query for safety
  }


  db.query(query, [statusFilter], (err, results) => {
    if (err) {
      res.status(500).send('Error fetching moulds data');
    } else {
      res.json(results);  // Send the mold data as JSON
    }
  });
});


// Route to fetch mold details by moldNo
app.get('/api/getmold/:moldNo', (req, res) => {
  const { moldNo } = req.params;
  const query = 'SELECT * FROM mold WHERE moldNo = ?';
  db.query(query, [moldNo], (err, results) => {
    if (err) {
      console.error('Error fetching mold data: ', err);
      res.status(500).send('Error fetching mould data');
    } else if (results.length === 0) {
      res.status(404).send('Mould not found');
    } else {
      res.json(results[0]);
    }
  });
});


/// Route to update mold details
app.put('/api/updatemold/:moldNo', (req, res) => {
  const { moldNo } = req.params;
  const {
    moldType, date, lifespan, status,
    maintainanceAlert, moldManufacturerName, manufacturerContact,
    moldAddedBy, remark,
  } = req.body;

  const query = `
        UPDATE mold
        SET
            moldType = ?, date = ?, lifespan = ?, status = ?,
            maintainanceAlert = ?, moldManufacturerName = ?, manufacturerContact = ?,
            moldAddedBy = ?, remark = ?
        WHERE moldNo = ?
    `;
  const values = [
    moldType, date, lifespan, status,
    maintainanceAlert, moldManufacturerName, manufacturerContact,
    moldAddedBy, remark, moldNo,
  ];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error('Error updating mould data: ', err);
      res.status(500).json({ message: 'Error updating mould data' });
    } else if (result.affectedRows === 0) {
      res.status(404).json({ message: 'Mould not found' });
    } else {
      res.status(200).json({ message: 'Mould details updated successfully' });
    }
  });
});

//report page

app.get('/api/get-weekly-data/:moldNo', (req, res) => {
  const { moldNo } = req.params;

  if (!moldNo) {
    return res.status(400).send('Mould number is required');
  }

  // Define the queries
  const queryProduction = `
    SELECT SUM(
            COALESCE(production_cnt, 0)
        ) AS production_cnt
    FROM mold_data_entry
    WHERE mold_number = ? 
    ;
  `;

  const queryMaintenance = `
    SELECT COUNT(*) AS maintenance_count 
    FROM mold_data_entry 
    WHERE mold_number = ? AND problem_resolved = 'Yes' ;
  `;

  const queryCost = `
    SELECT SUM(cost) AS total_cost 
    FROM mold_data_entry 
    WHERE mold_number = ? ;
  `;

  // Function to execute a query and return a promise
  const executeQuery = (query, params) => {
    return new Promise((resolve, reject) => {
      db.query(query, params, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  };

  // Execute all queries in parallel using Promise.all
  Promise.all([
    executeQuery(queryProduction, [moldNo]),
    executeQuery(queryMaintenance, [moldNo]),
    executeQuery(queryCost, [moldNo])
  ])
    .then(([productionResult, maintenanceResult, costResult]) => {
      const dashboardData = {
        productionCount: productionResult[0]?.production_cnt || 0,
        maintenanceCount: maintenanceResult[0]?.maintenance_count || 0,
        totalCost: costResult[0]?.total_cost || 0
      };

      res.json(dashboardData);  // Send the data back as JSON
    })
    .catch(err => {
      console.error(err);
      res.status(500).send('Error fetching data');
    });
});




// Route to fetch data from mold_data_entry
app.get('/api/getDateEntry/:moldNo', (req, res) => {
  const { moldNo } = req.params; // Extract moldNo from the URL parameter
  const query = 'SELECT * FROM mold_data_entry WHERE mold_number = ? ORDER BY date_time DESC';

  // Execute the query with the provided moldNo
  db.query(query, [moldNo], (err, results) => {
    if (err) {
      console.error('Error fetching mould data:', err);
      res.status(500).send('Error fetching mould data');
    } else if (results.length === 0) {
      res.status(404).send('Mould not found');
    } else {
      res.json(results); // Return the results as JSON
    }
  });
});

//pie

app.get('/api/fetch-pie/:mold_id', (req, res) => {
  const { mold_id } = req.params; // Get mold_id from the request parameter

  // SQL query to fetch production_cnt and maxproduction based on mold_id
  const query = `
      SELECT SUM(COALESCE(E.production_cnt, 0)) AS production_cnt, 
      M.lifespan AS maxproduction
      FROM 
      mold_data_entry AS E
      LEFT JOIN 
      mold M 
      ON E.mold_number = M.moldNo
      WHERE 
      E.mold_number = ?  -- Match with the mold_id from the URL parameter
      GROUP BY 
      E.mold_number;`

  db.query(query, [mold_id], (err, results) => {
    if (err) {
      console.error('Error fetching production data: ', err);
      return res.status(500).json({ message: 'Database error', error: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No data found for this mould_id' });
    }

    // Return the result for the matched mold_id
    res.json(results[0]);
  });
});

// API to fetch mold data dynamically
app.get('/api/production-data', (req, res) => {
  const { view, mouldNo } = req.query;

  if (view === "weekly") {
    const query = `
      SELECT 
        DATE(date_time) AS date,
        SUM(COALESCE(production_cnt, 0)) AS production_count,
        COUNT(CASE WHEN breakdown_occur = 'yes' THEN 1 END) AS breakdown
      FROM mold_data_entry
      WHERE mold_number = ? AND date_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(date_time)
      ORDER BY date ASC;
    `;

    db.query(query, [mouldNo], (err, results) => {
      if (err) {
        console.error('Error fetching weekly data:', err);
        return res.status(500).send('Error fetching data');
      }

      const productionData = results.map(row => row.production_count);
      const breakdownData = results.map(row => row.breakdown);
      const labels = results.map(row => row.date);

      res.json({
        productionData,
        breakdownData,
        labels
      });
    });
  } else if (view === "monthly") {
    const query = `
      SELECT 
        DATE(date_time) AS date, 
        SUM(COALESCE(production_cnt, 0)) AS production_count, 
        COUNT(CASE WHEN breakdown_occur = 'yes' THEN 1 END) AS breakdown
      FROM mold_data_entry
      WHERE date_time >= CURDATE() - INTERVAL 30 DAY AND mold_number = ?
      GROUP BY DATE(date_time)
      ORDER BY date_time ASC;
    `;

    db.query(query, [mouldNo], (err, results) => {
      if (err) {
        console.error('Error fetching monthly data:', err);
        return res.status(500).send('Error fetching data');
      }

      const productionData = results.map(row => row.production_count);
      const breakdownData = results.map(row => row.breakdown);
      const labels = results.map(row => row.date);

      res.json({
        productionData,
        breakdownData,
        labels
      });
    });
  } else {
    res.status(400).send("Invalid view parameter.");
  }
});




// Route to handle form data submission (mold_data_entry)
// Route to handle form data submission (already provided by you)
app.post('/api/submit-data', (req, res) => {
  const data = req.body;
  console.log('Received Data:', data);

  const checkMoldQuery = `SELECT * FROM mold WHERE moldNo = ?`;

  db.query(checkMoldQuery, [data.moldNumber], (checkErr, checkResults) => {
    if (checkErr) {
      console.error('Error checking mold_number:', checkErr);
      return res.status(500).send('Failed to validate mold number');
    }

    if (checkResults.length === 0) {
      return res.status(400).send('Mold not found. Please add the mold first.');
    }

    const insertQuery = `
      INSERT INTO mold_data_entry(
        mold_type, mold_number, date_time, breakdown_occur, before_breakdown_production,
        problem_resolved, cost_needed, cost, after_breakdown_production, remark,
        operator_name, operator_id, production_cnt, remark_no_breakdown,
        operator_name_no_breakdown, operator_id_no_breakdown
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.moldType,
      data.moldNumber,
      data.dateTime,
      data.breakdownOccur || null,
      data.beforeBreakdownProduction || 0,
      data.problemResolved || "NA",
      data.costNeeded || "NA",
      data.cost || 0,
      data.afterBreakdownProduction || 0,
      data.remark || "NA",
      data.operatorName || "NA",
      data.operatorId || "NA",
      (Number(data.productionCnt) + Number(data.beforeBreakdownProduction) + Number(data.afterBreakdownProduction)) || 0,
      data.remarkNoBreakdown || "NA",
      data.operatorNameNoBreakdown || "NA",
      data.operatorIdNoBreakdown || "NA",
    ];

    db.query(insertQuery, values, (insertErr, insertResults) => {
      if (insertErr) {
        console.error('Error inserting data:', insertErr);
        return res.status(500).send('Failed to store data');
      }
      res.status(200).send({ status: 'success', message: 'Data stored successfully' });
      console.log(`Data Added Successfully. Mold No.: ${data.moldNumber}`);
    });
  });
});



// Start the Server

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} `);
});
