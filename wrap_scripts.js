const fs = require('fs');
const path = require('path');

const dir = 'content/platforms';
const files = [
    'discord.js', 'facebook.js', 'instagram.js', 'linkedin.js',
    'netflix.js', 'pinterest.js', 'reddit.js', 'tiktok.js', 'twitch.js'
];

files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.trim().startsWith('(function()') && !content.trim().startsWith('(() =>')) {
            const wrapped = `(function() {\n${content}\n})();`;
            fs.writeFileSync(filePath, wrapped);
            console.log(`Wrapped ${file}`);
        } else {
            console.log(`Skipped ${file} (already wrapped)`);
        }
    }
});
