// Prints a new unguessable client token (32 URL-safe characters).
console.log(require('node:crypto').randomBytes(24).toString('base64url'));
