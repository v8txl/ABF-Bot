const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const express = require('express');

// --- STATE DATABASE ---
let bordersOpen = true;

// Continuous totals fed directly from Roblox DataStores so they never reset to 0
let totalApplicantsCount = 0;
let passedCount = 0;
let deniedCount = 0;

// --- EXPRESS SERVER (Roblox Connection) ---
const app = express();
app.use(express.json());

// --- UPTIME ROBOT KEEP ALIVE ROUTE ---
app.all('/', (req, res) => {
    res.send('Bot is alive!');
});

app.get('/api/status', (req, res) => {
    res.json({ open: bordersOpen });
});

app.post('/api/submit', async (req, res) => {
    // Roblox will send the overall game totals along with individual exam details
    const { username, userId, passed, score, overallTotal, overallPassed, overallDenied } = req.body;

    // Sync the bot's memory with Roblox's permanent DataStore values
    if (overallTotal !== undefined) totalApplicantsCount = overallTotal;
    if (overallPassed !== undefined) passedCount = overallPassed;
    if (overallDenied !== undefined) deniedCount = overallDenied;

    // Case A: IF A PLAYER PASSES, SEND AN AUDIT LOG FOR MANUAL RANKING
    if (passed) {
        try {
            const channelId = process.env.AUDIT_CHANNEL_ID;
            const auditChannel = client.channels.cache.get(channelId);

            if (auditChannel) {
                const auditEmbed = new EmbedBuilder()
                    .setColor(0xFFA500) // Clean Orange for "Action Required"
                    .setTitle('📋 Exam Completed - Manual Review Required')
                    .setDescription(`A user has finished their citizenship exam. Please review their score and manually update their group rank if necessary.`)
                    .addFields(
                        { name: 'Roblox Username', value: `${username}`, inline: true },
                        { name: 'Exam Score', value: `**${score || 'N/A'}/20**`, inline: true },
                        { name: 'Action', value: `[View Roblox Profile](https://www.roblox.com/users/${userId || 1}/profile)` }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Status: Pending Staff Review' });

                await auditChannel.send({ embeds: [auditEmbed] });
                console.log(`📩 Passed audit embed sent to Discord for user ${username}.`);
            } else {
                console.error("❌ Audit channel could not be found. Check your AUDIT_CHANNEL_ID env variable!");
            }
        } catch (err) {
            console.error(`❌ Failed to send Discord audit for ${username}: `, err.message);
        }
    } 
    // Case B: IF A PLAYER FAILS, SEND A DIFFERENT EMBED TO THE FAILED LOGS CHANNEL
    else {
        try {
            const failedChannelId = process.env.FAILED_CHANNEL_ID;
            const failedChannel = client.channels.cache.get(failedChannelId);

            if (failedChannel) {
                const failedEmbed = new EmbedBuilder()
                    .setColor(0xFF0000) // Bright Red for "Failed"
                    .setTitle('❌ Exam Failed - Application Denied')
                    .setDescription(`A user has failed their citizenship exam and was automatically disconnected from the processing server.`)
                    .addFields(
                        { name: 'Roblox Username', value: `${username}`, inline: true },
                        { name: 'Exam Score', value: `**${score || '0'}/20**`, inline: true },
                        { name: 'Requirement', value: `Requires 18/20`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'Status: Automatically Denied' });

                await failedChannel.send({ embeds: [failedEmbed] });
                console.log(`📩 Failed log embed sent to Discord for user ${username}.`);
            } else {
                console.error("❌ Failed logs channel could not be found. Check your FAILED_CHANNEL_ID env variable!");
            }
        } catch (err) {
            console.error(`❌ Failed to send Discord fail log for ${username}: `, err.message);
        }
    }

    res.json({ success: true });
});

app.listen(3000, () => console.log('🚀 API Bridge running on port 3000'));

// --- DISCORD BOT CONFIG ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder().setName('openborders').setDescription('Allows the citizenship test to be taken'),
        new SlashCommandBuilder().setName('closeborders').setDescription('Locks down the test and kicks incoming players'),
        new SlashCommandBuilder().setName('audit').setDescription('Shows test metrics over the past 28 days')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅ Commands registered!');
    } catch (error) {
        console.error(error);
    }
});

// --- AUTHORIZED ROLES LIST ---
const ALLOWED_ROLES = ['Border Staff', 'Administrator', 'High Command'];

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guild) {
        return interaction.reply({ content: '❌ Commands can only be used inside a server.', ephemeral: true });
    }

    const hasRole = interaction.member.roles.cache.some(role => 
        ALLOWED_ROLES.includes(role.name) || ALLOWED_ROLES.includes(role.id)
    );

    if (!hasRole) {
        return interaction.reply({ 
            content: '❌ **Access Denied:** You do not have the required staff role to control the borders.', 
            ephemeral: true 
        });
    }

    if (interaction.commandName === 'openborders') {
        bordersOpen = true;
        await interaction.reply('🔓 **Borders Open:** Citizenship testing is now active.');
    }

    if (interaction.commandName === 'closeborders') {
        bordersOpen = false;
        await interaction.reply('🔒 **Borders Closed:** Incoming players will now be automatically disconnected.');
    }

    if (interaction.commandName === 'audit') {
        const embed = new EmbedBuilder()
            .setTitle('📊 Citizenship Audit Report')
            .setDescription('Summary of processing metrics pulled straight from live border logs.')
            .setColor(3447003)
            .addFields(
                { name: 'Total Applicants', value: `${totalApplicantsCount}`, inline: true },
                { name: '✅ Passed', value: `${passedCount}`, inline: true },
                { name: '❌ Denied', value: `${deniedCount}`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
