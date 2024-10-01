// models/Instance.js
const mongoose = require('mongoose');

const InstanceSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Assuming you have a User model
        required: true,
    },
    status: {
        type: String,
        enum: ['Running', 'Stopped', 'Error'], // Possible status values
        default: 'Stopped', // Default status
    },
    os: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true, // Make password required
    },
    ipAddress: {
        type: String,
        required: false, // Optional field for IP address
    },
    vmid: {
        type: Number,
        required: true, // VMID is typically required for Proxmox
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    ip: {
        type: String,
        required: true,
        unique: true, // Ensure each instance has a unique IP address
    },
    port: {
        type: Number,
        required: true,
        unique: true, // Ensure each instance has a unique port
    },
    // Add other fields as needed (e.g., resource limits)
});

const Instance = mongoose.model('Instance', InstanceSchema);

module.exports = Instance;
