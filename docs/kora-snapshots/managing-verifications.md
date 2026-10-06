---
updatedAt: 2025-02-28T00:13:00.000Z
agentTools:
  projectIndex: https://developers.korapay.com/llms.txt
---

# Managing Verifications

## Querying KYC & KYB verifications

You can query and retrieve an already verified KYC or KYB identity in order to get the status of the verification and the details of the ID using the verification reference.

To do this, make a GET request to the Query endpoint:

`https://api.korapay.com/merchant/api/v1/identities/verifications/:reference`

The request body should have the following parameters:

| Field       | Data Type | Description                                                    |
| :---------- | :-------- | :------------------------------------------------------------- |
| `reference` | String    | **Required** - this is the reference of the verification event |

The response to this request will look like this:

```json Response
{
   "status": true,
   "message": "Verification retrieved successfully",
   "data": {
       "reference": "VR-0ahOHKGsPde5LiaS9",
       "full_name": "MARK LAWSON",
       "id": "C987464748983",
       "id_type": "gh_ssnit",
       "first_name": "MARK",
       "last_name": "LAWSON",
       "middle_name": null,
       "image": "data:image/jpg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/4RDcRXh",
       "date_of_birth": "1980-11-12",
       "card_serial": "00000012447855",
       "nationality": "GHANAIAN",
       "fss_no": "C987464748983",
       "gender": "male",
       "type": "kyc",
       "class": "id_lookup",
       "identity_type": "gh_ssnit",
       "country": "gh",
       "requested_by": "API User",
       "status": "found",
       "date_created": "2024-08-02T13:12:43.216Z"
   }
}
```

***

## Fetching KYC & KYB verification history

You can retrieve the history of your verified KYC and KYB identity verification events for a period using the Verification History API

To do this, make a POST request to the Verification history endpoint with the desired period:

`https://api.korapay.com/merchant/api/v1/identities/verifications`

The request body should have the following parameters:

| Field        | Data Type | Description                                                                                                    |
| :----------- | :-------- | :------------------------------------------------------------------------------------------------------------- |
| `start_date` | String    | **Optional** - this is the specific date to begin the records retrieval.                                       |
| `end_date`   | String    | **Optional** - this is the specific date to end the records retrieval.                                         |
| `limit`      | String    | **Optional** - this is the number of logs/events to be returned. Default value is `10`, maximum value is `50`. |
| `page`       | String    | **Optional** - this is the page number of the requested events. Default value is `1`.                          |

The response to this request will look like this:

```json Response
{
   "status": true,
   "message": "Verifications retrieved successfully",
   "data": {
       "data": [
           {
               "reference": "VR-0ahOHKGsPde5LiaS9",
               "full_name": "MARK LAWSON",
               "type": "kyc",
               "class": "id_lookup",
               "identity_type": "gh_ssnit",
               "identity_type_label": "SSNIT",
               "identity_type_description": "Ghanaian Social Security and National Insurance Trust",
               "country": "gh",
               "merchant": {
                   "reference": "MC-xxswqdfehhutwexxx",
                   "name": "Ten Violatte Nigeria LTD",
                   "email": "hustlaviola@gmail.com"
               },
               "requested_by": "API User",
               "status": "found",
               "date_created": "2024-08-02T13:12:43.216Z"
           },
           {
               "reference": "VR-6dKJUn25FmSksBLLg",
               "full_name": "OSEI YAW",
               "type": "kyc",
               "class": "id_lookup",
               "identity_type": "gh_drivers_license",
               "identity_type_label": "Driver's License",
               "identity_type_description": "Ghanaian Driver's License",
               "country": "gh",
               "merchant": {
                   "reference": "MC-xxswqdfehhutwexxx",
                   "name": "Ten Violatte Nigeria LTD",
                   "email": "hustlaviola@gmail.com"
               },
               "requested_by": "API User",
               "status": "found",
               "result": "invalid",
               "date_created": "2024-08-02T13:11:44.943Z"
           }
       ],
       "paging": {
           "total_items": 145,
           "page_size": 2,
           "current": 1,
           "count": 2,
           "next": 2
       },
       "links": [
           {
               "href": "https://api.koraapi.com/merchant/api/v1/verifications?limit=20&isWeb=false&page=1",
               "rel": "current",
               "method": "GET"
           },
           {
               "href": "https://api.koraapi.com/merchant/api/v1/verifications?limit=20&isWeb=false&page=2",
               "rel": "next",
               "method": "GET"
           }
       ]
   }
}
```

***

## Verification Events on the Kora Dashboard

Kora allows businesses to seamlessly view and manage verification events from the Kora dashboard. To do so, simply go to the **Identity** page on the main menu and click on the Verification Events tab. This will display all the KYC and KYB identity verifications performed by you.

<Image align="center" src="https://files.readme.io/cdba5f2-Screenshot_2024-08-06_at_09-10-07_Korapay_Welcome.png" />

<br />

Clicking on a verification event takes you to the event details page where you would see more information about the event, as well as the result of the check.

<Image align="center" src="https://files.readme.io/cdba5f2-Screenshot_2024-08-06_at_09-10-07_Korapay_Welcome.png" />

<br />

On the Billing page, you would see a list of all the fees that have been charged on your account for each completed verification check.

<Image align="center" src="https://files.readme.io/7cbbf06-Screenshot_2024-08-06_at_09-19-05_Korapay_Welcome.png" />