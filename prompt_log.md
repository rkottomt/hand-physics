# Prompt Log — Hand Physics (15-113 Project 2)

This file is kept separate from [README.md](README.md). Prompts are copied word for word from my Claude Code session history, typos included.

## Which tool for which job
| Tool | Job |
|---|---|
| Claude Code (Claude Opus 5.5), in the terminal | The only AI tool I used. Brainstorming the idea, writing the game code and levels, writing the tests, building the leaderboard backend, the redesign, committing to git and deploying to Vercel. |
| MediaPipe Hand Landmarker | The ML model that finds hand landmarks in the webcam video. Runs in the browser. |
| Matter.js | The physics engine (bodies, collisions, the grab spring). |
| Playwright | Browser tests, including a fake webcam fed a hand photo. |
| Vercel + Upstash Redis | Hosting, the serverless leaderboard function, and its database. |

## One place AI got it wrong
Claude's first fix for the Balancing Act seesaw added torque scaled by the plank's inertia (`plank.torque -= plank.inertia * (...)`). Claude expected this to work, but Matter.js multiplies torque by the time step squared, so the simulation blew up to angles around 10^200 degrees and then NaN. The parameter-sweep test exposed it immediately. The fix was to adjust the plank's angular velocity directly each step (a velocity-level spring), then tune the strength in simulation.

## What I changed myself
I changed the colors of the UI based off what I liked from a color picker and implemented that cross all instances of the UI.

#1 I want to create a game involving computer vision where people can interact with games using their hands, tell me what libraries and stuff I need to use to understand this

#2 Work on tracking my hand and give me a demo game hosted locally to determine if the tracking is working correctly

#3 Let me pinch the ball to move

#4 For the first level develop a game where I have to pinch the ball and place it in a square and it has to stay there for a set amount of time to pass the level

#5 For the second level make there be several different colored blocks and I have to stack them up to a certain point 

#6 make a basketball themed one where I have to throw a ball into a hoop. let the walls act as a backboard sort of

#7 make one where I have to knock off balls off varying different level heights

#8 make one where I have to properly balance blocks on a scale, ensure that the physics is proper

#9 make a final fun level where the user can do whatever they want, give me options of what features to include in this level

#10 give options the user to use their mouse instead of camera

#11 the UI looks way too ai generated, use no emojis and change the overall template to a beige color

#12 include a leaderboard hosted on a database

#13 the physics for level 5 seems off, please fact check this

#14 give an option to mute music

#15 add an info question button

#16 give a grid background to each game
