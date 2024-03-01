# -- USAGE --
```
1. Join a Voice Channel
2. Type "!join #CHANNEL"
2.5 You can mention a voice channel either by "#[CHANNEL_NAME]" or using "<#[CHANNEL_ID]>"
3. The USERBOT will record all users in the channel and end recording after 3 seconds of silence
4. After silence, .PCM file will be processed into .MP3 and stored in temp dir*
```

# -- REMINDER --
This will create a temporary folder in the **CWD** named *'./tmp_data_store'*
The processed and unprocessed audio *(before being deleted)* will be stored here.

Also note that the decoder does **NOT** add silence frames.
Meaning the audio recording will only be including audio recieved from discord while the user was talking, and not when the user was silent.