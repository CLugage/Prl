// utils/proxmoxClient.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const util = require('util');
const https = require('https');

dotenv.config();

// Proxmox API client setup with ignoring SSL certificate errors
const proxmox = axios.create({
    baseURL: `https://${process.env.PROXMOX_HOST}:8006/api2/json`,
    headers: {
        'Content-Type': 'application/json',
    },
    httpsAgent: new https.Agent({
        rejectUnauthorized: false, // Ignore SSL certificate errors
    }),
});


// Store authentication ticket and CSRF token
let authTicket = '';
let csrfToken = '';

// Function to log in to Proxmox
async function login() {
    try {
        const requestData = {
            username: process.env.PROXMOX_USER,
            password: process.env.PROXMOX_PASSWORD,
        };
        console.log('Login request data:', requestData); // Log the request data
        const response = await proxmox.post('/access/ticket', requestData);
        
        // Handle response...
    } catch (error) {
        console.error('Error logging in to Proxmox:', error.message);
        console.error('Login error response:', error.response?.data); // Log error response for debugging
        throw new Error('Failed to log in to Proxmox');
    }
}



// Function to create an LXC container
async function createInstance(vmid, osPath, hostname, password, ip, port) {
    await login();
    try {
        // Log in to Proxmox if not already authenticated
        if (!authTicket) {
            await login();
        }

        // Check if the OS template file exists
        if (!fs.existsSync(osPath)) {
            throw new Error(`OS template not found: ${osPath}`);
        }

        // Prepare the payload for creating the LXC container
        const payload = {
            vmid: vmid,
            ostemplate: osPath, // Assuming the API accepts a path for the OS template
            hostname: hostname,
            password: password,
            net0: `name=eth0,bridge=vmbr1,ip=${ip},gw=10.10.10.1`,
            // Additional configuration options as needed
        };

        // Call Proxmox API to create the instance
        const response = await proxmox.post(`/nodes/${process.env.PROXMOX_NODE}/lxc`, payload);

        if (response.status === 200 || response.status === 201) {
            console.log(`Instance created successfully: ${response.data.data.vmid}`);
            // Replace SSH configuration after the container is created
            await updateSSHConfig(ip, port);
            return response.data.data.vmid; // Return VMID or any other relevant info
        } else {
            throw new Error(`Failed to create instance: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error creating Proxmox instance:', error.message);
        throw new Error('Failed to create Proxmox instance'); // Re-throw the error for handling in the route
    }
}

// Function to update SSH configuration
async function updateSSHConfig(ip, port) {
    try {
        // The path to your custom sshd_config file
        const sshdConfigPath = path.join(__dirname, '/sshd_config.txt'); // Update this path

        // Use SCP to copy the new sshd_config to the container
        await execPromise(`scp -P ${port} ${sshdConfigPath} root@${ip}:/etc/ssh/sshd_config`);
        
        // Restart SSH service in the container to apply changes
        await execPromise(`ssh -p ${port} root@${ip} systemctl restart ssh`);

        console.log(`SSH configuration updated successfully for IP: ${ip}`);
    } catch (error) {
        console.error('Error updating SSH configuration:', error.message);
        throw new Error('Failed to update SSH configuration');
    }
}

// Promisify exec for easier use
const execPromise = util.promisify(exec);

// Export the function
module.exports = {
    createInstance,
    updateSSHConfig,
};
