axios.post('https://api.everyonegetsnews.org/info', {
    token: window.localStorage.getItem('token'),
    email: window.localStorage.getItem('email')
})
    .then(function (responseAxios) {
        if (responseAxios.status === 200) {
            const userObject = JSON.parse(responseAxios.data);
            const date = new Date(userObject.refresh*1000);
            if (Date.now() > userObject.refresh*1000) {
                if (userObject.refresh === 0) {
                    document.getElementById('Exp label').textContent = 'No plan active!'
                    document.getElementById('Expiry date').textContent = 'Please reload your balance to activate a plan.'
                } else {
                    document.getElementById('Exp label').textContent = 'Plan expired at:'
                }
            }
            document.getElementById('Expiry date').textContent = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
            document.getElementById('Balance').textContent = `$${userObject.balance}`
        } else {
            console.log(responseAxios);
        }
    })
    .catch(function (error) {
        console.log(error);
    });