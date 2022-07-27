/**
 * @file Functions to analyze and archive meaningful github contributors data
 * @example To archive contributors leaderboard data in csv file, run `node contributors.js`
 */

const https = require('https');

//INPUTS
const REPO_OWNER = "Git-Commit-Show";//Change this to the repo that you 
const GITHUB_PERSONAL_TOKEN = "";//When used, it will increase the API limits from 60 to 5000/hr
//End of inputs

const GITHUB_REQUEST_OPTIONS = {
    headers: {
        "User-Agent": "gh-contributors",
        "Content-Type": "application/json"
    }
}

if(GITHUB_PERSONAL_TOKEN){
    GITHUB_REQUEST_OPTIONS.headers["Authorization"] = "token "+GITHUB_PERSONAL_TOKEN;
}

/**
 * Get all github repos of an owner(user/org)
 * @param {String} owner 
 * @param {Number} pageNo 
 * @returns Promise<Array<Object> | String> JSON array of data on success, error on failure
 * @example getAllRepos('myorghandle').then((repos) => console.log(repos)).catch((err) => console.log(err))
 */
async function getAllRepos(owner, pageNo = 1) {
    return new Promise((resolve, reject) => {
        let url = `https://api.github.com/orgs/${owner}/repos?per_page=100&page=${pageNo}`;
        console.log(url);
        https.get(url, GITHUB_REQUEST_OPTIONS, (res) => {
            console.log('statusCode:', res.statusCode);
            // console.log('headers:', res.headers);
            let data = '';
            res.on('data', (d) => {
                data += d;
            })
            res.on('end', async () => {
                console.log("Repo list request finished")
                // console.log(data)
                let dataJsonArray = JSON.parse(data);
                if (dataJsonArray.length == 100) {
                    //It might have more data on the next page
                    pageNo++;
                    try {
                        let dataFromNextPage = await getAllRepos(owner, pageNo);
                        dataJsonArray.push(...dataFromNextPage);
                    } catch (err) {
                        console.log("No more pagination needed")
                    }
                }
                resolve(dataJsonArray);
            })
        }).on('error', (e) => {
            console.error(e);
            reject(e)
        });
    })
}

/**
 * Get contributors for a Github repo
 * @param {*} fullRepoName e.g. myorghandle/myreponame
 * @param {*} pageNo 
 * @returns Promise<Array<Object> | String>
 * @example getRepoContributors('myorghandle/myreponame').then((contributors) => console.log(contributors)).catch((err) => console.log(err))
 */
async function getRepoContributors(fullRepoName, pageNo = 1) {
    return new Promise((resolve, reject) => {
        let url = `https://api.github.com/repos/${fullRepoName}/contributors?per_page=100&page=${pageNo}`;
        console.log(url);
        https.get(url, GITHUB_REQUEST_OPTIONS, (res) => {
            console.log('statusCode:', res.statusCode);
            // console.log('headers:', res.headers);
            let data = '';
            res.on('data', (d) => {
                data += d;
            })
            res.on('end', async () => {
                console.log("Contributors request finished for " + fullRepoName)
                // console.log(data)
                let dataJsonArray = JSON.parse(data);
                if (dataJsonArray.length == 100) {
                    //It might have more data on the next page
                    pageNo++;
                    try {
                        let dataFromNextPage = await getRepoContributors(fullRepoName, pageNo);
                        dataJsonArray.push(...dataFromNextPage);
                    } catch (err) {
                        console.log("No more pagination needed")
                    }
                }
                resolve(dataJsonArray);
            })
        }).on('error', (e) => {
            console.error(e);
            reject(e)
        });
    })
}

/**
 * Get all contributors across all the repos of an owner
 * @param {*} owner github user or org handle
 */
async function getAllContributors(owner) {
    let repos = await getAllRepos(owner);
    if (!repos || repos.length < 1) {
        console.log("Error in getting repos for " + owner)
        throw ("Error in getting repos for " + owner)
    }
    console.log(repos.length + " " + owner + " repos found")
    // console.log(repos)
    let allContributors = [];
    for (let i = 0; i < repos.length - 1; i++) {
        if(repos[i].fork || repos[i].private) {
            // Exclude forks repos and private repos from the analysis
            console.log("Excluding "+repos[i].full_name);
            continue;
        }
        let c = await getRepoContributors(repos[i].full_name);
        // Add repo info in the contributor object 
        // so later we can use this info to discover repos that a contributor has contributed to
        c.forEach((item) => item.repo = repos[i].full_name);
        console.log(c.length + " contributors found for " + repos[i].full_name);
        if (c) allContributors.push(...c);
    }
    console.log("allContributors count without aggregation " + allContributors.length);
    // Remove duplicates in contributors list and sum total contributions for each contributor
    let finalListOfContributors = aggregateAllContributors(allContributors).sort(function (contributor1, contributor2) {
        // Sort the array in descending order of contributions
        return contributor2.contributions - contributor1.contributions
    })
    // Sort the repos field in order of descending contributions count
    finalListOfContributors.forEach((contributor) => {        
        contributor.repos = sortReposByContributionsCount(contributor.repos);
        contributor.topContributedRepo = contributor.repos[0].repo_full_name;
        contributor.allContributedRepos = contributor.repos.map((repoContributionMap) => repoContributionMap.repo_full_name).join(" | ")
    })
    console.log("finalListOfContributors count with aggregation" + finalListOfContributors.length);
    return finalListOfContributors;
}

/**
 * Adds up all the contributions by a contributor to different repos
 * @param {*} contributors 
 */
function aggregateAllContributors(contributors) {
    return contributors.reduce(function (grouped, currentItem) {
        // Skipping the bots and other non individual user
        if (currentItem.type !== "User") {
            return grouped;
        }
        let found = false;
        grouped.forEach(function (contributor) {
            if (contributor.login == currentItem.login) {
                found = true;
                contributor.repos.push({ repo_full_name: currentItem.repo, contributions: currentItem.contributions });
                contributor.contributions += currentItem.contributions;
                console.log("Aggregated contributions of " + contributor.login + " - " + contributor.contributions);
            }
        })
        if (!found) {
            currentItem.repos = [{ repo_full_name: currentItem.repo, contributions: currentItem.contributions }];
            grouped.push(currentItem);
        }
        return grouped;
    }, [])
}

/**
 * Lists all the repos a contributor has contributed to sorted by # of contributions
 * @param {Array<Object>} repoContributionMappingArray e.g. [{ repo_full_name, contributions }]
 * @returns {String} e.g. orghandle/repo1,orghandle/repo2
 */
function sortReposByContributionsCount(repoContributionMappingArray){
    return repoContributionMappingArray.sort((repoContributionMapping1, repoContributionMapping2) => {
        return repoContributionMapping2.contributions - repoContributionMapping1.contributions
    })
}

function writeContributorLeaderboardToFile(contributors) {
    const fs = require('fs');
    let ghContributorLeaderboard = contributors.map((contributor) => {
        return ["@" + contributor.login, contributor.contributions, contributor.html_url, contributor.avatar_url, contributor.topContributedRepo, contributor.allContributedRepos].join();
    }).join("\n");
    ghContributorLeaderboard = "Github Username,Total Contributions,Profile,Avatar,Most Contribution To,Contributed To\n" + ghContributorLeaderboard;
    fs.writeFile("./gh-contributors-leaderboard.csv", ghContributorLeaderboard, { flag: 'a+' }, function (err) {
        if (err) {
            return console.log(err);
        }
        console.log("The file was saved!");
    });
}

/**
 * Archives contributors leaderboard data sorted by contrbutions in a file
 * @param {*} owner 
 */
async function archiveContributorsLeaderboard(owner) {
    let contributors = await getAllContributors();
    if (!contributors || contributors.length < 1) {
        console.log("Failed to get contributors for "+owner);
        return;
    }

    // Summary - handles of contributors sorted by their contributions
    let ghHandles = contributors.map((contributor) => "@" + contributor.login)
    console.log(ghHandles.join(", "))

    // Write the complete leaderboard data to a file
    writeContributorLeaderboardToFile(contributors);

    return ghHandles;
}

archiveContributorsLeaderboard(REPO_OWNER)
