const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const fs = require('fs');
const { exec } = require('child_process');
const User = require('./models/User');
const Instance = require('./models/Instance');
const { createInstance } = require('./proxmoxClient');

dotenv.config();
const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
}));

const osPaths = {
    'ubuntu-23.04': '/var/lib/vz/template/cache/ubuntu-23.04-standard_23.04-1_amd64.tar.zst', 
    // Add other OS paths here
};

const CUSTOM_SSHD_CONFIG_PATH = '/sshd_config.txt';

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Authentication check middleware
function checkAuth(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
}

// Home Route
app.get('/', (req, res) => {
    res.render('index');
});

// Login Routes
app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
        return res.status(400).send('Invalid username or password');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
        return res.status(400).send('Invalid username or password');
    }

    req.session.userId = user._id; // Store user ID in session
    res.redirect('/dashboard'); // Redirect to dashboard on successful login
});

// Registration Routes
app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
        return res.status(400).send('Username already taken');
    }

    // Check if email already exists
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
        return res.status(400).send('Email already taken');
    }

    // Hash the password and save the user
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    req.session.userId = user._id; // Store user ID in session
    res.redirect('/dashboard'); // Redirect to dashboard on successful registration
});

// Dashboard Route
app.get('/dashboard', checkAuth, async (req, res) => {
    try {
        const instances = await Instance.find({ userId: req.session.userId });
        res.render('dashboard', { instances });
    } catch (error) {
        console.error('Error fetching instances:', error);
        res.status(500).send('Failed to fetch instances.');
    }
});

// Function to get the next available IP address
async function getNextAvailableIP() {
    const instances = await Instance.find();
    const existingIPs = instances.map(instance => instance.ip);
    let nextIP = '10.10.10.3'; // Starting IP address (first container)

    // Find the next available IP address
    while (existingIPs.includes(nextIP)) {
        const lastSegment = parseInt(nextIP.split('.').pop());
        nextIP = `10.10.10.${lastSegment + 1}`;
    }

    return nextIP; // Return the next available IP address
}

// Function to update NAT scripts
async function updateNatScripts(ip, port) {
    const natPreDownPath = '/path/to/nat-pre-down.sh'; // Update with the correct path
    const natPostUpPath = '/path/to/nat-post-up.sh'; // Update with the correct path

    // Prepare commands to update the NAT scripts
    const natPreDownContent = `iptables -t nat -D PREROUTING -i vmbr0 -p tcp --dport ${port} -j DNAT --to ${ip}:22\n`;
    const natPostUpContent = `iptables -t nat -A PREROUTING -i vmbr0 -p tcp --dport ${port} -j DNAT --to ${ip}:22\n`;

    // Write to the nat-pre-down.sh file
    fs.appendFileSync(natPreDownPath, natPreDownContent, { encoding: 'utf8' });
    // Write to the nat-post-up.sh file
    fs.appendFileSync(natPostUpPath, natPostUpContent, { encoding: 'utf8' });

    console.log('NAT scripts updated successfully');
}

// Function to execute the NAT post-up command
async function runNatPostUp() {
    const natPostUpPath = '/path/to/nat-post-up.sh'; // Update with the correct path

    exec(`bash ${natPostUpPath}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing nat-post-up.sh: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`Error in nat-post-up.sh: ${stderr}`);
            return;
        }
        console.log(`nat-post-up.sh executed successfully:\n${stdout}`);
    });
}

// Create Instance Route
app.get('/create-instance', checkAuth, (req, res) => {
    res.render('create-instance');
});

app.post('/api/create-instance', checkAuth, async (req, res) => {
    try {
        const { hostname, os, password } = req.body; // Adjust to match your form fields
        const userId = req.session.userId; // Assuming you store userId in session

        // Get the next available VMID
        const vmid = await getNextAvailableVMID();

        // Get the next available IP address
        const ip = await getNextAvailableIP();

        // Generate a random port (You can customize the port range)
        const port = Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024; // Random port between 1024 and 65535

        // Retrieve the correct OS file path
        const osPath = osPaths[os];
        if (!osPath) {
            return res.status(400).json({ message: 'Invalid OS selected' });
        }

        // Create a new instance
        const newInstance = new Instance({
            name: hostname,
            userId,
            os,
            password, // Store password securely; consider hashing it
            vmid,
            ip,
            port,
            status: 'Stopped', // Default status
        });

        // Save the instance to the database
        await newInstance.save();

        // Call function to create the container in Proxmox
        await createInstance(vmid, osPath, hostname, password, ip, port);

        // Update NAT scripts with the new IP and port
        await updateNatScripts(ip, port);

        // Run the nat-post-up.sh command
        await runNatPostUp();

        // Read the custom sshd_config contents
        const sshdConfigContents = fs.readFileSync(CUSTOM_SSHD_CONFIG_PATH, 'utf8').replace(/'/g, "'\\''");

        // Copy the custom sshd_config contents into the new container
        const copySshdConfigCommand = `pct exec ${vmid} -- bash -c "echo '${sshdConfigContents}' > /etc/ssh/sshd_config && systemctl restart sshd"`;
        
        exec(copySshdConfigCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error updating sshd_config: ${error.message}`);
                return res.status(500).json({ message: 'Error updating SSH configuration' });
            }
            if (stderr) {
                console.error(`Error in updating sshd_config: ${stderr}`);
                return res.status(500).json({ message: 'Error updating SSH configuration' });
            }
            console.log(`sshd_config updated successfully:\n${stdout}`);
        });

        // Send a response back
        res.status(201).json({ message: 'Instance created successfully', vmid });
    } catch (error) {
        console.error('Error creating instance:', error);
        res.status(500).json({ message: 'Error creating instance' });
    }
});


// Function to get the next available VMID
async function getNextAvailableVMID() {
    try {
        const instances = await Instance.find().select('vmid');
        const existingVMIDs = instances.map(instance => instance.vmid);
        existingVMIDs.sort((a, b) => a - b);

        let nextVMID = 100; // Starting VMID (you can adjust this)
        for (const vmid of existingVMIDs) {
            if (vmid !== nextVMID) {
                break; // Found a gap
            }
            nextVMID++;
        }

        return nextVMID; // Return the next available VMID
    } catch (error) {
        console.error('Error fetching VMIDs:', error);
        throw error;
    }
}

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
