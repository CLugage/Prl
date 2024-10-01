// fetchStatus.js
const ProxmoxAPI = require('proxmox-api-node'); // Use your Proxmox API client
const Instance = require('./models/Instance'); // Adjust the path to your Instance model

const proxmox = new ProxmoxAPI({
    host: process.env.PROXMOX_HOST, // Your Proxmox host
    user: process.env.PROXMOX_USER, // Your Proxmox user
    password: process.env.PROXMOX_PASSWORD, // Your Proxmox password
    port: 8006,
    ssl: {
        rejectUnauthorized: false, // Adjust as necessary
    },
});

// Function to fetch and update instance statuses
const fetchAndUpdateStatus = async () => {
    try {
        const instances = await Instance.find(); // Fetch all instances

        for (const instance of instances) {
            // Replace 'vmid' with the actual ID of your instance in Proxmox
            const status = await proxmox.get(`nodes/YOUR_NODE_NAME/lxc/${instance.vmid}/status/current`);

            // Update the instance status in the database
            instance.status = status.data.status; // Adjust based on the actual response
            await instance.save();
        }
    } catch (error) {
        console.error('Error fetching instance statuses:', error);
    }
};

// Run fetchAndUpdateStatus every 10 seconds
setInterval(fetchAndUpdateStatus, 10000); // 10 seconds

module.exports = fetchAndUpdateStatus;
